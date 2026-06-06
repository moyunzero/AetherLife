import { COLYSEUS_SERVER_MESSAGES, type ColyseusLoreSyncPayload } from "@aetherlife/shared";
import { getColyseusRoom } from "../colyseus/room-registry.js";

export function broadcastLoreSync(
  mapRoomId: string,
  entries: ColyseusLoreSyncPayload["entries"],
  options?: { triggerSessionId?: string },
): void {
  const room = getColyseusRoom(mapRoomId);
  if (!room) return;

  for (const client of room.clients) {
    const payload: ColyseusLoreSyncPayload = {
      entries: entries.map((entry) => {
        if (
          entry.isFirstDiscover &&
          options?.triggerSessionId &&
          client.sessionId !== options.triggerSessionId
        ) {
          const { isFirstDiscover: _omit, ...rest } = entry;
          return rest;
        }
        return entry;
      }),
    };
    client.send(COLYSEUS_SERVER_MESSAGES.loreSync, payload);
  }
}
