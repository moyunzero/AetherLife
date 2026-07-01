import { afterEach, describe, expect, it } from "vitest";
import {
  COUNCIL_NPC_IDS,
  createDefaultRoom,
  HOME_DEFAULT_PLAYER_SPAWN,
} from "@aetherlife/shared";
import { runAmbientTick } from "../ambient/tick.js";
import { clearChunkDeltaMemory } from "../world/chunk-repository.js";
import { ChunkLoader } from "../world/chunk-loader.js";
import {
  clearColyseusRoomRegistry,
  registerColyseusRoom,
} from "./room-registry.js";
import {
  collectPlayerCells,
  findPlayerCellByPlayerId,
  resetColyseusFromMap,
  roomStateForInitiator,
  syncColyseusFromMap,
} from "./bridge.js";
import { GameRoomState, PlayerSchema } from "./schema.js";

describe("syncColyseusFromMap", () => {
  it("creates MapSchema slots for all 12 council NPC ids", () => {
    const map = createDefaultRoom("default");
    const colyseus = new GameRoomState();
    syncColyseusFromMap(colyseus, map);

    expect(colyseus.npcs.size).toBe(12);
    for (const npcId of COUNCIL_NPC_IDS) {
      const slot = colyseus.npcs.get(npcId);
      expect(slot, `missing colyseus slot for ${npcId}`).toBeDefined();
      const mapNpc = map.npcs.find((n) => n.id === npcId);
      expect(slot!.x).toBe(mapNpc!.x);
      expect(slot!.y).toBe(mapNpc!.y);
    }
    expect(colyseus.doorOpen).toBe(false);
  });

  it("incrementally updates changed fields and deletes stale map keys", () => {
    const map = createDefaultRoom("bridge-incremental");
    const colyseus = new GameRoomState();
    syncColyseusFromMap(colyseus, map);

    const npc1 = map.npcs.find((n) => n.id === "npc-1")!;
    npc1.x = 7;
    npc1.y = 1;
    npc1.activityKey = "reading";
    map.objects = [{ id: "door-1", kind: "door", x: 3, y: 3, state: "open" }];
    map.npcs = map.npcs.filter((n) => n.id !== "npc-12");

    syncColyseusFromMap(colyseus, map);

    const slot1 = colyseus.npcs.get("npc-1")!;
    expect(slot1.x).toBe(7);
    expect(slot1.y).toBe(1);
    expect(slot1.activityKey).toBe("reading");
    expect(colyseus.npcs.has("npc-12")).toBe(false);
    expect(colyseus.doorOpen).toBe(true);
  });

  it("preserves moved NPC coordinates on second sync (reconnect / resume)", () => {
    const map = createDefaultRoom("bridge-resume");
    const colyseus = new GameRoomState();
    syncColyseusFromMap(colyseus, map);

    const npc3 = map.npcs.find((n) => n.id === "npc-3")!;
    const movedX = npc3.x + 4;
    const movedY = npc3.y + 2;
    npc3.x = movedX;
    npc3.y = movedY;

    syncColyseusFromMap(colyseus, map);

    const slot3 = colyseus.npcs.get("npc-3")!;
    expect(slot3.x).toBe(movedX);
    expect(slot3.y).toBe(movedY);
  });
});

describe("initiator player view", () => {
  afterEach(() => {
    clearColyseusRoomRegistry();
  });

  it("collectPlayerCells prefers Colyseus players over legacy map.player", () => {
    const map = createDefaultRoom("default");
    map.player = { x: 99, y: 99 };

    const state = new GameRoomState();
    const player = new PlayerSchema();
    player.playerId = "player-alpha01";
    player.x = 6;
    player.y = 1;
    state.players.set("sess-a", player);

    registerColyseusRoom("default", { state } as never);

    const cells = collectPlayerCells("default", map);
    expect(cells).toEqual([{ x: 6, y: 1 }]);
    expect(cells.some((c) => c.x === 99)).toBe(false);
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
    expect(map.player).toEqual({ x: 34, y: 13 });
  });

  it("legacy reset snaps all players to home spawn, not map.player anchor", () => {
    const map = createDefaultRoom("legacy-reset");
    map.player = { x: 50, y: 50 };

    const state = new GameRoomState();
    const player = new PlayerSchema();
    player.playerId = "player-legacy01";
    player.x = 10;
    player.y = 10;
    state.players.set("sess-legacy", player);
    registerColyseusRoom("legacy-reset", { state } as never);

    resetColyseusFromMap("legacy-reset", map);

    const snapped = state.players.get("sess-legacy")!;
    expect(Math.abs(snapped.x - HOME_DEFAULT_PLAYER_SPAWN.x)).toBeLessThanOrEqual(2);
    expect(Math.abs(snapped.y - HOME_DEFAULT_PLAYER_SPAWN.y)).toBeLessThanOrEqual(2);
    expect(snapped.x).not.toBe(50);
  });
});

describe("ambient tick schema sync", () => {
  it("npc-1 activityKey matches map after runAmbientTick", async () => {
    clearChunkDeltaMemory();
    const map = createDefaultRoom("ambient-bridge");
    const colyseus = new GameRoomState();
    colyseus.gameMinute = 360;
    syncColyseusFromMap(colyseus, map);
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
      recentNpcCells: new Map(),
    });

    expect(map.npcs.find((n) => n.id === "npc-1")!.activityKey).toBe("reading");
    expect(colyseus.npcs.get("npc-1")!.activityKey).toBe("reading");
  });
});
