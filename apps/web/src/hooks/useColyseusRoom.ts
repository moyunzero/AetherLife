import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Client, type Room } from "@colyseus/sdk";
import {
  COLYSEUS_CLIENT_MESSAGES,
  COLYSEUS_ORPHAN_SHARD_WS_CODE,
  COLYSEUS_ROOM_FULL_CODE,
  COLYSEUS_ROOM_FULL_WS_CODE,
  COLYSEUS_ROOM_NAME,
  COLYSEUS_SERVER_MESSAGES,
  buildMoveGrid,
  canStepTo,
  createDefaultRoom,
  findGridPath,
  type ColyseusMoveAckPayload,
  type ColyseusMovePayload,
  type RoomState,
} from "@aetherlife/shared";
import { getOrCreatePlayerId, readLastGridPos, writeLastGridPos } from "../lib/playerSession.js";

export type PlayerSnapshot = {
  sessionId: string;
  playerId: string;
  x: number;
  y: number;
  facing: string;
};

const wsUrl =
  import.meta.env.VITE_GAME_SERVER_WS ||
  `ws://${typeof window !== "undefined" ? window.location.hostname : "127.0.0.1"}:2567`;

const STEP_MS = 140;
const REMOTE_INTERP_MS = 130;
const BLOCKED_MOVE_HINT = "该方向无法移动（NPC、门或其他玩家占格）";
const BLOCKED_PATH_HINT = "无法到达该格（被 NPC、门或其他玩家挡住）";

type PlayerEntry = {
  sessionId?: string;
  playerId?: string;
  x: number;
  y: number;
  facing: string;
};

type PlayersMap = {
  forEach?: (fn: (p: PlayerEntry, sessionId: string) => void) => void;
  $items?: Map<string, PlayerEntry>;
};

function snapshotPlayers(room: Room): PlayerSnapshot[] {
  const list: PlayerSnapshot[] = [];
  const map = (room.state as { players?: PlayersMap }).players;
  if (!map) return list;

  if (typeof map.forEach === "function") {
    map.forEach((p, sessionId) => {
      list.push({
        sessionId,
        playerId: p.playerId ?? "",
        x: p.x,
        y: p.y,
        facing: p.facing,
      });
    });
    return list;
  }

  if (map.$items) {
    for (const [sessionId, p] of map.$items) {
      list.push({
        sessionId: p.sessionId ?? sessionId,
        playerId: p.playerId ?? "",
        x: p.x,
        y: p.y,
        facing: p.facing,
      });
    }
  }
  return list;
}

let joinGeneration = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRoomFullError(err: unknown): boolean {
  if (err === COLYSEUS_ROOM_FULL_WS_CODE) return true;
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  return (
    lower.includes(COLYSEUS_ROOM_FULL_CODE) ||
    lower.includes("max clients") ||
    lower.includes("room is full") ||
    lower.includes("locked")
  );
}

export type SyncMetrics = {
  rttMs: number | null;
  corrections: number;
};

export function useColyseusRoom(roomId = "default", map: RoomState | null = null) {
  const roomRef = useRef<Room | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [connected, setConnected] = useState(false);
  const [players, setPlayers] = useState<PlayerSnapshot[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [roomFull, setRoomFull] = useState(false);
  const [visualPos, setVisualPos] = useState<{ x: number; y: number } | null>(null);
  const [animating, setAnimating] = useState(false);
  const [moveHint, setMoveHint] = useState<string | null>(null);
  const [syncMetrics, setSyncMetrics] = useState<SyncMetrics>({ rttMs: null, corrections: 0 });
  const animatingRef = useRef(false);
  const playersRef = useRef(players);
  const visualPosRef = useRef(visualPos);
  const mapRef = useRef(map);
  const clientSeqRef = useRef(0);
  const pendingMovesRef = useRef<{ clientSeq: number; sentAt: number }[]>([]);
  playersRef.current = players;
  visualPosRef.current = visualPos;
  mapRef.current = map;

  useEffect(() => {
    if (!visualPos || !sessionId) return;
    const self = players.find((p) => p.sessionId === sessionId);
    if (self && self.x === visualPos.x && self.y === visualPos.y) {
      setVisualPos(null);
    }
  }, [players, sessionId, visualPos]);

  useEffect(() => {
    if (!moveHint) return;
    const t = window.setTimeout(() => setMoveHint(null), 3000);
    return () => window.clearTimeout(t);
  }, [moveHint]);

  const displayPlayers = useMemo(() => {
    if (!visualPos || !sessionId) return players;
    return players.map((p) =>
      p.sessionId === sessionId ? { ...p, x: visualPos.x, y: visualPos.y } : p,
    );
  }, [players, sessionId, visualPos]);

  const remoteInterpMs = REMOTE_INTERP_MS;

  useEffect(() => {
    const generation = ++joinGeneration;
    let activeRoom: Room | null = null;
    let restoredGridPos = false;
    const client = new Client(wsUrl);
    const playerId = getOrCreatePlayerId();

    const applySnapshots = (joined: Room) => {
      const snapshots = snapshotPlayers(joined);
      setPlayers(snapshots);
      const sid = joined.sessionId;
      const self = snapshots.find((p) => p.sessionId === sid);
      if (!self) return;

      if (!restoredGridPos) {
        restoredGridPos = true;
        const saved = readLastGridPos(roomId);
        if (saved && (saved.x !== self.x || saved.y !== self.y)) {
          const seq = ++clientSeqRef.current;
          pendingMovesRef.current.push({ clientSeq: seq, sentAt: Date.now() });
          joined.send(COLYSEUS_CLIENT_MESSAGES.move, {
            targetX: saved.x,
            targetY: saved.y,
            clientSeq: seq,
          });
          return;
        }
      }

      writeLastGridPos(roomId, self.x, self.y);
    };

    const onMoveAck = (data: ColyseusMoveAckPayload) => {
      if (generation !== joinGeneration) return;
      const sentAt = pendingMovesRef.current.find((m) => m.clientSeq === data.clientSeq)?.sentAt;
      if (sentAt) {
        const rtt = Date.now() - sentAt;
        setSyncMetrics((m) => ({ ...m, rttMs: rtt }));
      }
      pendingMovesRef.current = pendingMovesRef.current.filter((m) => m.clientSeq > data.clientSeq);

      const sid = activeRoom?.sessionId;
      const self = playersRef.current.find((p) => p.sessionId === sid);
      const visual = visualPosRef.current;
      const serverMismatch = self && (self.x !== data.x || self.y !== data.y);
      const visualMismatch = visual && (visual.x !== data.x || visual.y !== data.y);
      if (serverMismatch || visualMismatch) {
        setSyncMetrics((m) => ({ ...m, corrections: m.corrections + 1 }));
        setMoveHint("位置已与服务器同步。");
        setVisualPos({ x: data.x, y: data.y });
      } else {
        setVisualPos(null);
      }
      writeLastGridPos(roomId, data.x, data.y);
    };

    const attachRoom = (joined: Room) => {
      if (generation !== joinGeneration) {
        void joined.leave();
        return;
      }
      activeRoom = joined;
      roomRef.current = joined;
      setRoom(joined);
      setSessionId(joined.sessionId);
      setConnected(true);
      setError(null);
      setRoomFull(false);
      applySnapshots(joined);

      joined.onStateChange(() => {
        if (generation !== joinGeneration) return;
        applySnapshots(joined);
      });

      joined.onMessage(COLYSEUS_SERVER_MESSAGES.moveAck, onMoveAck);
    };

    const failJoin = (err: unknown) => {
      if (generation !== joinGeneration) return;
      if (isRoomFullError(err)) {
        setRoomFull(true);
        setError("房间已满（最多 4 人），请稍后再试。");
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg || "Colyseus join failed");
      }
      setConnected(false);
    };

    const joinOptions = { mapRoomId: roomId, playerId };

    const attemptJoin = async (attempt: number): Promise<void> => {
      try {
        let joined: Room;
        try {
          joined = await client.join(COLYSEUS_ROOM_NAME, joinOptions);
        } catch (joinErr) {
          if (isRoomFullError(joinErr)) {
            failJoin(joinErr);
            return;
          }
          joined = await client.joinOrCreate(COLYSEUS_ROOM_NAME, joinOptions);
        }
        joined.onLeave((code, reason) => {
          if (generation !== joinGeneration) return;
          if (isRoomFullError(code) || isRoomFullError(reason)) {
            setRoomFull(true);
            setError("房间已满（最多 4 人），请稍后再试。");
            setConnected(false);
            setRoom(null);
            setSessionId(null);
            roomRef.current = null;
            activeRoom = null;
            return;
          }
          if (code === COLYSEUS_ORPHAN_SHARD_WS_CODE && attempt < 5) {
            void attemptJoin(attempt + 1);
          }
        });
        attachRoom(joined);
      } catch (err) {
        if (generation !== joinGeneration) return;
        if (isRoomFullError(err)) {
          failJoin(err);
          return;
        }
        if (attempt < 5) {
          await sleep(400 * (attempt + 1));
          if (generation !== joinGeneration) return;
          return attemptJoin(attempt + 1);
        }
        failJoin(err);
      }
    };

    void attemptJoin(0);

    return () => {
      joinGeneration += 1;
      const leaving = activeRoom ?? roomRef.current;
      activeRoom = null;
      roomRef.current = null;
      clientSeqRef.current = 0;
      pendingMovesRef.current = [];
      setRoom(null);
      setConnected(false);
      if (leaving) void leaving.leave();
    };
  }, [roomId]);

  const sendMove = useCallback(
    (dx: number, dy: number) => {
      if (animatingRef.current) return;
      const sid = sessionId;
      const self = playersRef.current.find((p) => p.sessionId === sid);
      if (!self || !sid) return;

      const fromX = visualPosRef.current?.x ?? self.x;
      const fromY = visualPosRef.current?.y ?? self.y;
      const toX = fromX + dx;
      const toY = fromY + dy;
      const mapState = mapRef.current ?? createDefaultRoom(roomId);
      const others = playersRef.current
        .filter((p) => p.sessionId !== sid)
        .map((p) => ({ x: p.x, y: p.y }));

      if (!canStepTo(mapState, toX, toY, others)) {
        setMoveHint(BLOCKED_MOVE_HINT);
        setVisualPos(null);
        return;
      }

      const seq = ++clientSeqRef.current;
      pendingMovesRef.current.push({ clientSeq: seq, sentAt: Date.now() });
      setVisualPos({ x: toX, y: toY });
      const payload: ColyseusMovePayload = { dx, dy, clientSeq: seq };
      roomRef.current?.send(COLYSEUS_CLIENT_MESSAGES.move, payload);
    },
    [roomId, sessionId],
  );

  const sendMoveTo = useCallback(
    async (targetX: number, targetY: number) => {
      if (animatingRef.current) return;
      const sid = sessionId;
      const self = playersRef.current.find((p) => p.sessionId === sid);
      if (!self || !sid) {
        const seq = ++clientSeqRef.current;
        pendingMovesRef.current.push({ clientSeq: seq, sentAt: Date.now() });
        roomRef.current?.send(COLYSEUS_CLIENT_MESSAGES.move, { targetX, targetY, clientSeq: seq });
        return;
      }

      const mapForPath = map ?? createDefaultRoom(roomId);
      const others = playersRef.current
        .filter((p) => p.sessionId !== sid)
        .map((p) => ({ x: p.x, y: p.y }));
      const grid = buildMoveGrid(mapForPath, others);
      const path = findGridPath(self.x, self.y, targetX, targetY, grid);
      if (!path) {
        setMoveHint(BLOCKED_PATH_HINT);
        return;
      }
      if (path.length <= 1) return;

      animatingRef.current = true;
      setAnimating(true);
      try {
        for (let i = 1; i < path.length; i++) {
          const step = path[i]!;
          setVisualPos({ x: step.x, y: step.y });
          await sleep(STEP_MS);
        }
        const seq = ++clientSeqRef.current;
        pendingMovesRef.current.push({ clientSeq: seq, sentAt: Date.now() });
        roomRef.current?.send(COLYSEUS_CLIENT_MESSAGES.move, { targetX, targetY, clientSeq: seq });
        setVisualPos({ x: targetX, y: targetY });
      } finally {
        animatingRef.current = false;
        setAnimating(false);
      }
    },
    [map, roomId, sessionId],
  );

  return {
    room,
    roomRef,
    connected,
    players: displayPlayers,
    sessionId,
    error,
    roomFull,
    animating,
    moveHint,
    sendMove,
    sendMoveTo,
    syncMetrics,
    remoteInterpMs,
  };
}
