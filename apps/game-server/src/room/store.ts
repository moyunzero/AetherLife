import { createDefaultRoom, type RoomState } from "@aetherlife/shared";

export type RoomRecord = {
  state: RoomState;
};

const rooms = new Map<string, RoomRecord>();

export function getOrCreate(roomId: string): RoomRecord {
  let record = rooms.get(roomId);
  if (!record) {
    record = { state: createDefaultRoom(roomId) };
    rooms.set(roomId, record);
  }
  return record;
}

export function reset(roomId: string): RoomRecord {
  const record: RoomRecord = { state: createDefaultRoom(roomId) };
  rooms.set(roomId, record);
  return record;
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
