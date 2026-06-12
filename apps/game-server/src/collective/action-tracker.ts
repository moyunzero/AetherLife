import {
  detectCollaborateTransfer,
  detectCompeteObject,
  recordNpcTransfer,
  recordObjectInteract,
  type ActionRuleResult,
} from "./rule-detector.js";

const recentByObject = new Map<string, { playerId: string; at: number }>();
const recentByNpc = new Map<string, { playerId: string; at: number }>();

function objectKey(roomId: string, objectId: string): string {
  return `${roomId}:${objectId}`;
}

function npcKey(roomId: string, toNpcId: string): string {
  return `${roomId}:${toNpcId}`;
}

export function detectRoomCompeteObject(
  roomId: string,
  objectId: string,
  initiatorPlayerId: string,
  now: number,
  windowMs: number,
): ActionRuleResult {
  return detectCompeteObject(
    objectKey(roomId, objectId),
    initiatorPlayerId,
    recentByObject,
    now,
    windowMs,
  );
}

export function detectRoomCollaborateTransfer(
  roomId: string,
  toNpcId: string,
  initiatorPlayerId: string,
  now: number,
  windowMs: number,
): ActionRuleResult {
  return detectCollaborateTransfer(
    npcKey(roomId, toNpcId),
    initiatorPlayerId,
    recentByNpc,
    now,
    windowMs,
  );
}

export function recordRoomObjectInteract(
  roomId: string,
  objectId: string,
  playerId: string,
  now: number,
): void {
  recordObjectInteract(objectKey(roomId, objectId), playerId, recentByObject, now);
}

export function recordRoomNpcTransfer(
  roomId: string,
  toNpcId: string,
  playerId: string,
  now: number,
): void {
  recordNpcTransfer(npcKey(roomId, toNpcId), playerId, recentByNpc, now);
}

export function clearActionTrackersForRoom(roomId: string): void {
  const prefix = `${roomId}:`;
  for (const key of [...recentByObject.keys()]) {
    if (key.startsWith(prefix)) recentByObject.delete(key);
  }
  for (const key of [...recentByNpc.keys()]) {
    if (key.startsWith(prefix)) recentByNpc.delete(key);
  }
}

/** Clear compete/collaborate windows for one initiator (multiplayer reset). */
export function clearActionTrackersForPlayer(roomId: string, playerId: string): void {
  const prefix = `${roomId}:`;
  for (const [key, entry] of recentByObject.entries()) {
    if (key.startsWith(prefix) && entry.playerId === playerId) recentByObject.delete(key);
  }
  for (const [key, entry] of recentByNpc.entries()) {
    if (key.startsWith(prefix) && entry.playerId === playerId) recentByNpc.delete(key);
  }
}

/** @internal vitest */
export function clearAllActionTrackers(): void {
  recentByObject.clear();
  recentByNpc.clear();
}
