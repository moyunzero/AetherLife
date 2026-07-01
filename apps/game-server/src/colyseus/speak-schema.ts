import { findNpc, type RoomState } from "@aetherlife/shared";
import { getOrCreate } from "../room/store.js";
import { syncColyseusFromMap } from "./bridge.js";
import { getColyseusRoom } from "./room-registry.js";
import type { GameRoomState } from "./schema.js";
import { bumpStateVersion } from "./version.js";

export type NpcSpeakPhase = "idle" | "thinking" | "speaking";

/** Map npc.status + Colyseus isThinking/isSpeaking for multi-client speak visibility (D-MAP-SCHEMA-08). */
export function setNpcSpeakPhase(roomId: string, npcId: string, phase: NpcSpeakPhase): void {
  const { state: map } = getOrCreate(roomId);
  const npc = findNpc(map, npcId);
  if (!npc || npc.status === phase) return;
  npc.status = phase;
  syncNpcSpeakFlagsToColyseus(roomId, map);
}

export function syncNpcSpeakFlagsToColyseus(roomId: string, map: RoomState): void {
  const colyseus = getColyseusRoom(roomId);
  if (!colyseus) return;
  const gameState = colyseus.state as GameRoomState;
  syncColyseusFromMap(gameState, map);
  bumpStateVersion(gameState);
}
