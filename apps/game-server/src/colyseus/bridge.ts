import {
  HOME_DEFAULT_PLAYER_SPAWN,
  LEGACY_PLAYER_ID,
  normalizePlayerId,
  PLAYER_ID_HEADER,
  type GridCell,
  type RoomState,
} from "@aetherlife/shared";
import type { Request } from "express";
import { getOrCreate } from "../room/store.js";
import { getChunkLoader } from "../world/chunk-loader.js";
import { buildMoveGrid, findNearestWalkableCell } from "./move-handler.js";
import { getColyseusRoom } from "./room-registry.js";
import { bumpStateVersion } from "./version.js";
import { NpcEntityState, type GameRoomState } from "./schema.js";

function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

function syncNpcEntity(target: NpcEntityState, npc: RoomState["npcs"][number]): void {
  const activityKey = npc.activityKey ?? "idle";
  const intentReasonZh = npc.intentReasonZh ?? "";
  const joinActive = npc.joinVicinityActive ?? false;
  const joinUntil = npc.joinVicinityUntil ?? 0;
  const joinStarted = npc.joinVicinityStartedAt ?? 0;
  const isThinking = npc.status === "thinking";
  const isSpeaking = npc.status === "speaking";

  if (target.x !== npc.x) target.x = npc.x;
  if (target.y !== npc.y) target.y = npc.y;
  if (target.activityKey !== activityKey) target.activityKey = activityKey;
  if (target.intentReasonZh !== intentReasonZh) target.intentReasonZh = intentReasonZh;
  if (target.joinVicinityActive !== joinActive) target.joinVicinityActive = joinActive;
  if (target.joinVicinityUntil !== joinUntil) target.joinVicinityUntil = joinUntil;
  if (target.joinVicinityStartedAt !== joinStarted) {
    target.joinVicinityStartedAt = joinStarted;
  }
  if (target.isThinking !== isThinking) target.isThinking = isThinking;
  if (target.isSpeaking !== isSpeaking) target.isSpeaking = isSpeaking;
}

/** Merge Colyseus player positions; legacy map.player only when no live multiplayer session. */
export function collectPlayerCells(roomId: string, map: RoomState): GridCell[] {
  const seen = new Set<string>();
  const cells: GridCell[] = [];
  const add = (x: number, y: number) => {
    const key = cellKey(x, y);
    if (seen.has(key)) return;
    seen.add(key);
    cells.push({ x, y });
  };

  const colyseus = getColyseusRoom(roomId);
  if (colyseus) {
    const state = colyseus.state as GameRoomState;
    state.players.forEach((player) => add(player.x, player.y));
    if (state.players.size > 0) {
      return cells;
    }
  }

  add(map.player.x, map.player.y);
  return cells;
}

/** HTTP routes: require X-Player-Id header match; when Colyseus live, player must be connected. */
export function assertScopedPlayerRequest(
  req: Request,
  playerId: string,
  roomId: string,
): { ok: true } | { ok: false; status: number; error: string } {
  const normalized = normalizePlayerId(playerId);
  if (normalized === LEGACY_PLAYER_ID) {
    return { ok: true };
  }

  const headerId = normalizePlayerId(req.get(PLAYER_ID_HEADER));
  if (!headerId || headerId !== normalized) {
    return {
      ok: false,
      status: 403,
      error: "X-Player-Id required and must match request scope",
    };
  }

  const colyseus = getColyseusRoom(roomId);
  if (!colyseus) {
    return { ok: true };
  }

  const state = colyseus.state as GameRoomState;
  let connected = false;
  state.players.forEach((player) => {
    if (normalizePlayerId(player.playerId) === normalized) {
      connected = true;
    }
  });
  if (!connected) {
    return { ok: false, status: 403, error: "player not connected to room" };
  }
  return { ok: true };
}

/** Live Colyseus position for the player who sent this turn (multiplayer). */
export function findPlayerCellByPlayerId(
  roomId: string,
  playerId: string,
): GridCell | null {
  const id = normalizePlayerId(playerId);
  if (!id || id === LEGACY_PLAYER_ID) return null;

  const colyseus = getColyseusRoom(roomId);
  if (!colyseus) return null;

  const state = colyseus.state as GameRoomState;
  let found: GridCell | null = null;
  state.players.forEach((player) => {
    if (player.playerId === id) {
      found = { x: player.x, y: player.y };
    }
  });
  return found;
}

/**
 * Room snapshot for LLM / worker: `state.player` = initiating human's grid cell.
 * Does not mutate the authoritative store.
 */
export function roomStateForInitiator(
  map: RoomState,
  roomId: string,
  playerId: string,
): RoomState {
  const cell = findPlayerCellByPlayerId(roomId, playerId);
  if (!cell) return map;
  return { ...map, player: { x: cell.x, y: cell.y } };
}

export function syncMapPlayerPosition(roomId: string, x: number, y: number): void {
  const { state } = getOrCreate(roomId);
  state.player.x = x;
  state.player.y = y;
}

export function syncColyseusFromMap(colyseus: GameRoomState, map: RoomState): void {
  const seen = new Set<string>();

  for (const npc of map.npcs) {
    seen.add(npc.id);
    let slot = colyseus.npcs.get(npc.id);
    if (!slot) {
      slot = new NpcEntityState();
      colyseus.npcs.set(npc.id, slot);
    }
    syncNpcEntity(slot, npc);
  }

  for (const id of [...colyseus.npcs.keys()]) {
    if (!seen.has(id)) {
      colyseus.npcs.delete(id);
    }
  }

  const door = map.objects.find((o) => o.id === "door-1");
  if (door) {
    colyseus.doorOpen = door.state === "open";
  }
}

/** After map reset: snap requesting player to home spawn; sync NPC/object slots for all clients. */
export function resetColyseusFromMap(
  roomId: string,
  map: RoomState,
  requestingPlayerId?: string,
): void {
  const colyseus = getColyseusRoom(roomId);
  if (!colyseus) return;
  const loader = getChunkLoader(roomId);
  const state = colyseus.state as GameRoomState;
  const scoped =
    requestingPlayerId &&
    requestingPlayerId !== LEGACY_PLAYER_ID &&
    normalizePlayerId(requestingPlayerId);

  if (scoped) {
    state.players.forEach((player, sessionId) => {
      if (player.playerId !== scoped) return;
      const grid = buildMoveGrid(map, state, sessionId, loader);
      const spawn = findNearestWalkableCell(
        HOME_DEFAULT_PLAYER_SPAWN.x,
        HOME_DEFAULT_PLAYER_SPAWN.y,
        grid,
      );
      player.x = spawn.x;
      player.y = spawn.y;
    });
  } else {
    state.players.forEach((player, sessionId) => {
      const grid = buildMoveGrid(map, state, sessionId, loader);
      const spawn = findNearestWalkableCell(
        HOME_DEFAULT_PLAYER_SPAWN.x,
        HOME_DEFAULT_PLAYER_SPAWN.y,
        grid,
      );
      player.x = spawn.x;
      player.y = spawn.y;
    });
  }
  syncColyseusFromMap(state, map);
  bumpStateVersion(state);
}
