import type { RoomState } from "@aetherlife/shared";
import type { StatePatchPayload } from "@aetherlife/shared";
import { syncColyseusFromMap } from "./bridge.js";
import type { GameRoomState } from "./schema.js";

/** Build NPC position delta for broadcast patch. */
export function buildNpcPositionDelta(map: RoomState): StatePatchPayload["delta"] {
  return {
    npcs: map.npcs.map((n) => ({ id: n.id, x: n.x, y: n.y })),
    doorOpen: map.objects.find((o) => o.id === "door-1")?.state === "open",
  };
}

export function bumpStateVersion(state: GameRoomState): number {
  state.stateVersion += 1;
  return state.stateVersion;
}

export function applyMapAndBumpVersion(
  colyseus: GameRoomState,
  map: RoomState,
): { stateVersion: number; delta: StatePatchPayload["delta"] } {
  syncColyseusFromMap(colyseus, map);
  const stateVersion = bumpStateVersion(colyseus);
  return { stateVersion, delta: buildNpcPositionDelta(map) };
}
