import {
  COLYSEUS_SERVER_MESSAGES,
  type CouncilDeliberationPublicState,
} from "@aetherlife/shared";
import { getColyseusRoom } from "../colyseus/room-registry.js";

export function broadcastCouncilDeliberationSync(
  mapRoomId: string,
  payload: CouncilDeliberationPublicState,
): void {
  const room = getColyseusRoom(mapRoomId);
  if (!room) return;

  for (const client of room.clients) {
    client.send(COLYSEUS_SERVER_MESSAGES.councilDeliberationSync, payload);
  }
}
