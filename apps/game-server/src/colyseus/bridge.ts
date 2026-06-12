import {
  HOME_DEFAULT_PLAYER_SPAWN,
  LEGACY_PLAYER_ID,
  normalizePlayerId,
  type GridCell,
  type RoomState,
} from "@aetherlife/shared";
import { getOrCreate } from "../room/store.js";
import { getChunkLoader } from "../world/chunk-loader.js";
import { buildMoveGrid, findNearestWalkableCell } from "./move-handler.js";
import { getColyseusRoom } from "./room-registry.js";
import { bumpStateVersion } from "./version.js";
import type { GameRoomState } from "./schema.js";

function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

/** Merge map snapshot player cell with all connected Colyseus player positions. */
export function collectPlayerCells(roomId: string, map: RoomState): GridCell[] {
  const seen = new Set<string>();
  const cells: GridCell[] = [];
  const add = (x: number, y: number) => {
    const key = cellKey(x, y);
    if (seen.has(key)) return;
    seen.add(key);
    cells.push({ x, y });
  };

  add(map.player.x, map.player.y);
  const colyseus = getColyseusRoom(roomId);
  if (colyseus) {
    const state = colyseus.state as GameRoomState;
    state.players.forEach((player) => add(player.x, player.y));
  }
  return cells;
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
  const npcSlots: Array<["npc1" | "npc2" | "npc3", string]> = [
    ["npc1", "npc-1"],
    ["npc2", "npc-2"],
    ["npc3", "npc-3"],
  ];

  for (const [slot, id] of npcSlots) {
    const npc = map.npcs.find((n) => n.id === id);
    if (!npc) continue;
    const activityKey = npc.activityKey ?? "idle";
    const intentReasonZh = npc.intentReasonZh ?? "";
    const joinActive = npc.joinVicinityActive ?? false;
    const joinUntil = npc.joinVicinityUntil ?? 0;
    const joinStarted = npc.joinVicinityStartedAt ?? 0;
    if (slot === "npc1") {
      colyseus.npc1X = npc.x;
      colyseus.npc1Y = npc.y;
      colyseus.npc1ActivityKey = activityKey;
      colyseus.npc1IntentReasonZh = intentReasonZh;
      colyseus.npc1JoinVicinityActive = joinActive;
      colyseus.npc1JoinVicinityUntil = joinUntil;
      colyseus.npc1JoinVicinityStartedAt = joinStarted;
    } else if (slot === "npc2") {
      colyseus.npc2X = npc.x;
      colyseus.npc2Y = npc.y;
      colyseus.npc2ActivityKey = activityKey;
      colyseus.npc2IntentReasonZh = intentReasonZh;
      colyseus.npc2JoinVicinityActive = joinActive;
      colyseus.npc2JoinVicinityUntil = joinUntil;
      colyseus.npc2JoinVicinityStartedAt = joinStarted;
    } else {
      colyseus.npc3X = npc.x;
      colyseus.npc3Y = npc.y;
      colyseus.npc3ActivityKey = activityKey;
      colyseus.npc3IntentReasonZh = intentReasonZh;
      colyseus.npc3JoinVicinityActive = joinActive;
      colyseus.npc3JoinVicinityUntil = joinUntil;
      colyseus.npc3JoinVicinityStartedAt = joinStarted;
    }
  }

  const door = map.objects.find((o) => o.id === "door-1");
  if (door) {
    colyseus.doorOpen = door.state === "open";
  }

  const bgSlots: Array<["bgNpc1" | "bgNpc2" | "bgNpc3" | "bgNpc4", string]> = [
    ["bgNpc1", "bg-villager-1"],
    ["bgNpc2", "bg-villager-2"],
    ["bgNpc3", "bg-villager-3"],
    ["bgNpc4", "bg-villager-4"],
  ];

  for (const [slot, id] of bgSlots) {
    const npc = map.npcs.find((n) => n.id === id);
    const active = Boolean(npc);
    const activityKey = npc?.activityKey ?? "wandering";
    const x = npc?.x ?? 0;
    const y = npc?.y ?? 0;
    if (slot === "bgNpc1") {
      colyseus.bgNpc1Active = active;
      if (npc) {
        colyseus.bgNpc1X = x;
        colyseus.bgNpc1Y = y;
        colyseus.bgNpc1ActivityKey = activityKey;
      }
    } else if (slot === "bgNpc2") {
      colyseus.bgNpc2Active = active;
      if (npc) {
        colyseus.bgNpc2X = x;
        colyseus.bgNpc2Y = y;
        colyseus.bgNpc2ActivityKey = activityKey;
      }
    } else if (slot === "bgNpc3") {
      colyseus.bgNpc3Active = active;
      if (npc) {
        colyseus.bgNpc3X = x;
        colyseus.bgNpc3Y = y;
        colyseus.bgNpc3ActivityKey = activityKey;
      }
    } else {
      colyseus.bgNpc4Active = active;
      if (npc) {
        colyseus.bgNpc4X = x;
        colyseus.bgNpc4Y = y;
        colyseus.bgNpc4ActivityKey = activityKey;
      }
    }
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
    const anchor = map.player;
    state.players.forEach((player, sessionId) => {
      const grid = buildMoveGrid(map, state, sessionId, loader);
      const spawn = findNearestWalkableCell(anchor.x, anchor.y, grid);
      player.x = spawn.x;
      player.y = spawn.y;
    });
  }
  syncColyseusFromMap(state, map);
  bumpStateVersion(state);
}
