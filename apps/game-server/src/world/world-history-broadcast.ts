import {
  COLYSEUS_SERVER_MESSAGES,
  type ColyseusWorldHistorySyncPayload,
  type WorldHistoryPublicEntry,
} from "@aetherlife/shared";
import { getColyseusRoom } from "../colyseus/room-registry.js";

export function broadcastWorldHistorySync(
  mapRoomId: string,
  entry: WorldHistoryPublicEntry,
): void {
  const room = getColyseusRoom(mapRoomId);
  if (!room) return;

  const payload: ColyseusWorldHistorySyncPayload = { entry };
  for (const client of room.clients) {
    client.send(COLYSEUS_SERVER_MESSAGES.worldHistorySync, payload);
  }
}
