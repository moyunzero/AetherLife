import { afterEach, describe, expect, it } from "vitest";
import { createDefaultRoom } from "@aetherlife/shared";
import { runAmbientTick } from "../ambient/tick.js";
import { clearChunkDeltaMemory } from "../world/chunk-repository.js";
import { ChunkLoader } from "../world/chunk-loader.js";
import {
  clearColyseusRoomRegistry,
  registerColyseusRoom,
} from "./room-registry.js";
import {
  findPlayerCellByPlayerId,
  roomStateForInitiator,
  syncColyseusFromMap,
} from "./bridge.js";
import { GameRoomState, PlayerSchema } from "./schema.js";

describe("syncColyseusFromMap", () => {
  it("copies npc positions and door flag", () => {
    const map = createDefaultRoom("default");
    map.npcs[0]!.x = 7;
    map.npcs[0]!.y = 1;
    map.objects = [{ id: "door-1", kind: "door", x: 3, y: 3, state: "open" }];

    const colyseus = new GameRoomState();
    syncColyseusFromMap(colyseus, map);

    expect(colyseus.npc1X).toBe(7);
    expect(colyseus.npc1Y).toBe(1);
    expect(colyseus.doorOpen).toBe(true);
  });
});

describe("initiator player view", () => {
  afterEach(() => {
    clearColyseusRoomRegistry();
  });

  it("findPlayerCellByPlayerId reads Colyseus players map", () => {
    const state = new GameRoomState();
    const player = new PlayerSchema();
    player.playerId = "player-alpha01";
    player.x = 6;
    player.y = 1;
    state.players.set("sess-a", player);

    registerColyseusRoom("default", { state } as never);

    expect(findPlayerCellByPlayerId("default", "player-alpha01")).toEqual({ x: 6, y: 1 });
    expect(findPlayerCellByPlayerId("default", "missing-id-12")).toBeNull();
  });

  it("roomStateForInitiator overrides snapshot player cell", () => {
    const map = createDefaultRoom();
    const state = new GameRoomState();
    const player = new PlayerSchema();
    player.playerId = "player-bravo001";
    player.x = 1;
    player.y = 7;
    state.players.set("sess-b", player);
    registerColyseusRoom("default", { state } as never);

    const view = roomStateForInitiator(map, "default", "player-bravo001");
    expect(view.player).toEqual({ x: 1, y: 7 });
    expect(map.player).toEqual({ x: 4, y: 4 });
  });
});

describe("ambient tick schema sync", () => {
  it("npc1ActivityKey matches map after runAmbientTick", async () => {
    clearChunkDeltaMemory();
    const map = createDefaultRoom("ambient-bridge");
    const colyseus = new GameRoomState();
    colyseus.gameMinute = 360;
    const loader = new ChunkLoader({ worldId: "bridge-ambient", worldSeed: 42 });
    await loader.ensureChunksForPlayers(
      map.npcs.map((n) => ({ gx: n.x, gy: n.y })),
    );

    runAmbientTick({
      roomId: "ambient-bridge",
      gameState: colyseus,
      map,
      loader,
      npcSpeakJobs: new Map(),
      waypointCursors: new Map(),
    });

    expect(map.npcs[0]!.activityKey).toBe("reading");
    expect(colyseus.npc1ActivityKey).toBe("reading");
  });
});
