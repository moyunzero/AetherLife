import { Server } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { COLYSEUS_ROOM_NAME } from "@aetherlife/shared";
import type { Express } from "express";
import { GameRoom } from "./GameRoom.js";
import { bootWorldRegistry } from "../world/registry-boot.js";

let gameServer: Server | null = null;

/**
 * Attach and configure a Colyseus Server instance onto an existing Express app.
 *
 * Initializes the world registry, mounts the provided Express `app` onto Colyseus' internal express app,
 * defines and configures the game room (filtering by `mapRoomId` and sorting by client count), and stores
 * the created Server in the module-level `gameServer`.
 *
 * @param app - The Express application to register with Colyseus
 * @returns An object containing the created Colyseus `Server` as `colyseus`
 */
export function attachColyseus(app: Express): { colyseus: Server } {
  bootWorldRegistry();
  const colyseus = new Server({
    transport: new WebSocketTransport(),
    express: (colyseusApp) => {
      colyseusApp.use(app);
    },
  });
  colyseus
    .define(COLYSEUS_ROOM_NAME, GameRoom)
    .filterBy(["mapRoomId"])
    .sortBy({ clients: -1 });
  gameServer = colyseus;
  return { colyseus };
}

export function getGameServer(): Server | null {
  return gameServer;
}
