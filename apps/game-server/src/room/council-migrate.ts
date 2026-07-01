import { migrateRoomCouncilNpcs, type RoomState } from "@aetherlife/shared";
import { syncColyseusFromMap } from "../colyseus/bridge.js";
import { getColyseusRoom } from "../colyseus/room-registry.js";
import type { GameRoomState } from "../colyseus/schema.js";
import { bumpStateVersion } from "../colyseus/version.js";

/** Apply Phase 26 council migration and sync live Colyseus when the room is open. */
export function normalizeRoomCouncilState(roomId: string, state: RoomState): RoomState {
  const result = migrateRoomCouncilNpcs(state);
  if (!result.changed) return state;

  const colyseus = getColyseusRoom(roomId);
  if (colyseus) {
    const gameState = colyseus.state as GameRoomState;
    syncColyseusFromMap(gameState, result.state);
    bumpStateVersion(gameState);
  }

  return result.state;
}
