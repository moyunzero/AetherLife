import { Server } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { COLYSEUS_ROOM_NAME } from "@aetherlife/shared";
import type { Express } from "express";
import { GameRoom } from "./GameRoom.js";
import { bootWorldRegistry } from "../world/registry-boot.js";

let gameServer: Server | null = null;

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
