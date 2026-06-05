import type { GameRoom } from "./GameRoom.js";

const rooms = new Map<string, GameRoom>();

/** Returns false if another live room already owns this mapRoomId. */
export function tryClaimMapRoom(roomId: string, room: GameRoom): boolean {
  const existing = rooms.get(roomId);
  if (existing && existing !== room) return false;
  rooms.set(roomId, room);
  return true;
}

export function registerColyseusRoom(roomId: string, room: GameRoom): void {
  rooms.set(roomId, room);
}

export function unregisterColyseusRoom(roomId: string): void {
  rooms.delete(roomId);
}

export function getColyseusRoom(roomId: string): GameRoom | undefined {
  return rooms.get(roomId);
}

/** Test helper */
export function clearColyseusRoomRegistry(): void {
  rooms.clear();
}
