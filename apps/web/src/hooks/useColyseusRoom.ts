import { useCallback, useEffect, useRef, useState } from "react";
import type { LocalPlayerMotionBridge } from "../game/localPlayerMotion.js";
import { MovementSyncController } from "../game/MovementSyncController.js";
import { Client, type Room } from "@colyseus/sdk";
import {
  COLYSEUS_CLIENT_MESSAGES,
  COLYSEUS_ORPHAN_SHARD_WS_CODE,
  COLYSEUS_ROOM_FULL_CODE,
  COLYSEUS_ROOM_FULL_WS_CODE,
  COLYSEUS_ROOM_NAME,
  COLYSEUS_SERVER_MESSAGES,
  chunkViewsFingerprint,
  type ChunkView,
  type ColyseusChunksSyncPayload,
  type ColyseusLoreSyncPayload,
  type RoomState,
} from "@aetherlife/shared";

import { useChunkLore } from "./useChunkLore.js";
import { clearLastGridPos, getOrCreatePlayerId, readLastGridPos } from "../lib/playerSession.js";
import {
  snapshotAmbientStateFromSchema,
  type NpcAmbientSnapshot,
} from "../lib/colyseusAmbientSnapshot.js";

export type { NpcAmbientSnapshot };
export type GameClockState = {
  minute: number;
  label: string;
};

function snapshotAmbientState(room: Room) {
  return snapshotAmbientStateFromSchema(room.state as Parameters<typeof snapshotAmbientStateFromSchema>[0]);
}

export type PlayerSnapshot = {
  sessionId: string;
  playerId: string;
  x: number;
  y: number;
  facing: string;
};

/** Localhost: direct :2567 (reliable WS). Tunnel/preview: same-origin via Vite `/matchmake` proxy. */
function resolveColyseusWsUrl(): string {
  if (import.meta.env.VITE_GAME_SERVER_WS) {
    return import.meta.env.VITE_GAME_SERVER_WS;
  }
  if (typeof window !== "undefined" && typeof window.location?.hostname !== "undefined") {
    const { hostname, port, protocol } = window.location;
    const isLocalHost =
      hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
    if (!isLocalHost) {
      const p = port ? `:${port}` : "";
      return `${protocol.replace("http", "ws")}//${hostname}${p}`;
    }
  }
  return "ws://127.0.0.1:2567";
}

const wsUrl = resolveColyseusWsUrl();

const REMOTE_INTERP_MS = 130;

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
  /** In-flight predicted steps (syncDebug). */
  pending: number;
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
  const [syncMetrics, setSyncMetrics] = useState<SyncMetrics>({
    rttMs: null,
    corrections: 0,
    pending: 0,
  });
  const [loadedChunks, setLoadedChunks] = useState<ChunkView[]>([]);
  const [gameClock, setGameClock] = useState<GameClockState | null>(null);
  const [npcActivityById, setNpcActivityById] = useState<Record<string, string>>({});
  const [npcAmbientById, setNpcAmbientById] = useState<Record<string, NpcAmbientSnapshot>>({});
  const [mainNpcGridById, setMainNpcGridById] = useState<
    Record<string, { x: number; y: number }>
  >({});
  const [bgNpcGridById, setBgNpcGridById] = useState<Record<string, { x: number; y: number }>>(
    {},
  );
  const {
    mergeLoreSync,
    loreForChunk,
    consumeDiscoverToast,
    resetLore,
    toastQueue,
  } = useChunkLore();
  const roomIdRef = useRef(roomId);
  const playersRef = useRef(players);
  const sessionIdRef = useRef(sessionId);
  const mapRef = useRef(map);
  roomIdRef.current = roomId;
  const loadedChunksRef = useRef(loadedChunks);
  const motionBridgeRef = useRef<LocalPlayerMotionBridge | null>(null);
  const movementSyncRef = useRef<MovementSyncController | null>(null);
  sessionIdRef.current = sessionId;
  if (!movementSyncRef.current) {
    movementSyncRef.current = new MovementSyncController({
      onHint: (hint) => setMoveHint(hint),
      onPendingCount: (n) => {
        setSyncMetrics((m) => (m.pending === n ? m : { ...m, pending: n }));
      },
      onRttMs: (ms) => {
        setSyncMetrics((m) => ({ ...m, rttMs: ms }));
      },
      onCorrection: () => {
        setSyncMetrics((m) => ({ ...m, corrections: m.corrections + 1 }));
      },
      onAnimating: (v) => setAnimating(v),
      onVisualPos: setVisualPos,
    });
  }
  const loadedChunksFpRef = useRef("");
  playersRef.current = players;
  mapRef.current = map;
  loadedChunksRef.current = loadedChunks;

  const sync = movementSyncRef.current;
  sync.setDataSources({
    getRoomId: () => roomIdRef.current,
    getPlayers: () => playersRef.current,
    getSessionId: () => sessionIdRef.current,
    getMap: () => mapRef.current,
    getLoadedChunks: () => loadedChunksRef.current,
    getMotionBridge: () => motionBridgeRef.current,
    getJoinGeneration: () => joinGeneration,
  });

  useEffect(() => {
    if (!visualPos || !sessionId) return;
    if (sync.getPendingCount() > 0) return;
    const self = players.find((p) => p.sessionId === sessionId);
    if (self && self.x === visualPos.x && self.y === visualPos.y) {
      setVisualPos(null);
    }
  }, [players, sessionId, visualPos, sync]);

  useEffect(() => {
    if (!moveHint) return;
    const t = window.setTimeout(() => setMoveHint(null), 3000);
    return () => window.clearTimeout(t);
  }, [moveHint]);

  const remoteInterpMs = REMOTE_INTERP_MS;

  useEffect(() => {
    const generation = ++joinGeneration;
    let activeRoom: Room | null = null;
    let restoredGridPos = false;
    let offChunksSync: (() => void) | undefined;
    let offLoreSync: (() => void) | undefined;

    sync.setJoinGeneration(generation);
    const client = new Client(wsUrl);
    const playerId = getOrCreatePlayerId();

    const applySnapshots = (joined: Room) => {
      const snapshots = snapshotPlayers(joined);
      setPlayers(snapshots);
      const ambient = snapshotAmbientState(joined);
      setGameClock(ambient.gameClock);
      setNpcActivityById(ambient.npcActivityById);
      setNpcAmbientById(ambient.npcAmbientById);
      setMainNpcGridById(ambient.mainNpcGridById);
      setBgNpcGridById(ambient.bgNpcGridById);
      const sid = joined.sessionId;
      const self = snapshots.find((p) => p.sessionId === sid);
      if (!self) return;

      if (!restoredGridPos) {
        restoredGridPos = true;
        const saved = readLastGridPos(roomId);
        if (saved && (saved.x !== self.x || saved.y !== self.y)) {
          if (sync.pushRestoreMove(self, snapshots, saved)) {
            return;
          }
          clearLastGridPos(roomId);
        }
      }

      sync.onSchemaSelf(self);
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
      sync.attachRoom(joined);
      applySnapshots(joined);

      joined.onStateChange(() => {
        if (generation !== joinGeneration) return;
        applySnapshots(joined);
      });

      offChunksSync = joined.onMessage(
        COLYSEUS_SERVER_MESSAGES.chunksSync,
        (data: ColyseusChunksSyncPayload) => {
          if (generation !== joinGeneration) return;
          const chunks = data.chunks ?? [];
          const fp = chunkViewsFingerprint(chunks);
          if (fp === loadedChunksFpRef.current) return;
          loadedChunksFpRef.current = fp;
          loadedChunksRef.current = chunks;
          setLoadedChunks(chunks);
          sync.onLoadedChunksUpdated();
        },
      );
      offLoreSync = joined.onMessage(
        COLYSEUS_SERVER_MESSAGES.loreSync,
        (data: ColyseusLoreSyncPayload) => {
          if (generation !== joinGeneration) return;
          mergeLoreSync(data);
        },
      );
      joined.send(COLYSEUS_CLIENT_MESSAGES.requestChunksSync, {});
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
        // Prefer joinOrCreate — avoids spurious matchmake 521 when shard not yet created.
        const joined = await client.joinOrCreate(COLYSEUS_ROOM_NAME, joinOptions);
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
            sync.detachRoom();
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
      offChunksSync?.();
      offLoreSync?.();
      resetLore();
      const leaving = activeRoom ?? roomRef.current;
      activeRoom = null;
      roomRef.current = null;
      sync.reset();
      loadedChunksFpRef.current = "";
      setLoadedChunks([]);
      setGameClock(null);
      setNpcActivityById({});
      setNpcAmbientById({});
      setMainNpcGridById({});
      setBgNpcGridById({});
      setRoom(null);
      setConnected(false);
    };
  }, [roomId, sync, mergeLoreSync, resetLore]);

  /** MovementPanel fallback (no Phaser). Phaser path uses RoomScene → movementSync directly. */
  const sendMove = useCallback(
    (dx: number, dy: number) => {
      sync.sendWasd(dx, dy);
    },
    [sync],
  );

  const sendMoveTo = useCallback(
    (targetX: number, targetY: number) => {
      void sync.sendMoveTo(targetX, targetY);
    },
    [sync],
  );

  return {
    room,
    roomRef,
    motionBridgeRef,
    movementSyncRef,
    connected,
    players,
    sessionId,
    error,
    roomFull,
    animating,
    moveHint,
    sendMove,
    sendMoveTo,
    syncMetrics,
    remoteInterpMs,
    loadedChunks,
    loreForChunk,
    consumeDiscoverToast,
    loreToastQueue: toastQueue,
    gameClock,
    npcActivityById,
    npcAmbientById,
    mainNpcGridById,
    bgNpcGridById,
  };
}
