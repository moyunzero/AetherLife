import {
  LEGACY_PLAYER_ID,
  normalizePlayerId,
  type GridCell,
  type RoomState,
} from "@aetherlife/shared";
import { getOrCreate } from "../room/store.js";
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
    if (slot === "npc1") {
      colyseus.npc1X = npc.x;
      colyseus.npc1Y = npc.y;
    } else if (slot === "npc2") {
      colyseus.npc2X = npc.x;
      colyseus.npc2Y = npc.y;
    } else {
      colyseus.npc3X = npc.x;
      colyseus.npc3Y = npc.y;
    }
  }

  const door = map.objects.find((o) => o.id === "door-1");
  if (door) {
    colyseus.doorOpen = door.state === "open";
  }
}

/** After map reset: snap connected clients to default spawn and NPC slots. */
export function resetColyseusFromMap(roomId: string, map: RoomState): void {
  const colyseus = getColyseusRoom(roomId);
  if (!colyseus) return;
  const spawn = map.player;
  const state = colyseus.state as import("./schema.js").GameRoomState;
  state.players.forEach((player) => {
    player.x = spawn.x;
    player.y = spawn.y;
  });
  syncColyseusFromMap(state, map);
  bumpStateVersion(state);
}
