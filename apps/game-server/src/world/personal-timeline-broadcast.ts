import {
  COLYSEUS_SERVER_MESSAGES,
  type ColyseusPersonalTimelineSyncPayload,
} from "@aetherlife/shared";
import { getColyseusRoom } from "../colyseus/room-registry.js";

/** D-SYNC-01: hint-only — never full biography bodies on WS. */
export function broadcastPersonalTimelineSync(
  mapRoomId: string,
  payload: ColyseusPersonalTimelineSyncPayload,
): void {
  const room = getColyseusRoom(mapRoomId);
  if (!room) return;

  const hint: ColyseusPersonalTimelineSyncPayload = {
    npcId: payload.npcId,
    hasUpdate: payload.hasUpdate,
  };
  if (payload.latestSeq != null) {
    hint.latestSeq = payload.latestSeq;
  }

  for (const client of room.clients) {
    client.send(COLYSEUS_SERVER_MESSAGES.personalTimelineSync, hint);
  }
}
