import {
  COLYSEUS_SERVER_MESSAGES,
  type ColyseusRelationshipSyncPayload,
} from "@aetherlife/shared";
import { getColyseusRoom } from "../colyseus/room-registry.js";

/** D-API-01 / D-GRAPH-04: hint-only — never edge bodies on WS. */
export function broadcastRelationshipSync(
  mapRoomId: string,
  payload: ColyseusRelationshipSyncPayload,
): void {
  const room = getColyseusRoom(mapRoomId);
  if (!room) return;

  const hint: ColyseusRelationshipSyncPayload = {
    hasUpdate: payload.hasUpdate,
  };
  if (payload.latestSeq != null) {
    hint.latestSeq = payload.latestSeq;
  }

  for (const client of room.clients) {
    client.send(COLYSEUS_SERVER_MESSAGES.relationshipSync, hint);
  }
}
