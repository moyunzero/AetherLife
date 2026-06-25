import { createDefaultRoom, type RoomState } from "@aetherlife/shared";
import { seedCouncilMemoriesIfNeeded } from "../memory/councilSeed.js";

export type RoomRecord = {
  state: RoomState;
};

const MAX_ROOM_RECORDS = 128;
const rooms = new Map<string, RoomRecord>();

function touchRoom(roomId: string, record: RoomRecord): RoomRecord {
  rooms.delete(roomId);
  rooms.set(roomId, record);
  return record;
}

function evictOldestRoomIfNeeded(): void {
  if (rooms.size < MAX_ROOM_RECORDS) return;
  const oldest = rooms.keys().next().value;
  if (oldest !== undefined) {
    rooms.delete(oldest);
  }
}

export function getOrCreate(roomId: string): RoomRecord {
  const existing = rooms.get(roomId);
  if (existing) {
    return touchRoom(roomId, existing);
  }
  evictOldestRoomIfNeeded();
  const record: RoomRecord = { state: createDefaultRoom(roomId) };
  rooms.set(roomId, record);
  void seedCouncilMemoriesIfNeeded(roomId).catch((err) => {
    console.error("[council-seed] failed for room", roomId, err);
  });
  return record;
}

export function reset(roomId: string): RoomRecord {
  const record: RoomRecord = { state: createDefaultRoom(roomId) };
  return touchRoom(roomId, record);
}

export function setState(roomId: string, state: RoomState): RoomRecord {
  const record = getOrCreate(roomId);
  record.state = state;
  return record;
}

/** Test helper */
export function clearAllRooms(): void {
  rooms.clear();
}
