import { createDefaultRoom, defaultSpawnGlobal, findNpc } from "@aetherlife/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { clearChunkDeltaMemory } from "../world/chunk-repository.js";
import { ChunkLoader } from "../world/chunk-loader.js";
import {
  applyPlayerMove,
  applyPlayerMoveTo,
  buildMoveGrid,
  findGridPath,
} from "./move-handler.js";
import { GameRoomState, PlayerSchema } from "./schema.js";

function roomWithPlayer(x: number, y: number, sessionId = "s1") {
  const state = new GameRoomState();
  const player = new PlayerSchema();
  player.sessionId = sessionId;
  player.x = x;
  player.y = y;
  state.players.set(sessionId, player);
  return state;
}

async function loaderAround(gx: number, gy: number) {
  const loader = new ChunkLoader({ worldId: "move-test", worldSeed: 42 });
  await loader.ensureChunksForPlayers([{ gx, gy }]);
  return loader;
}

describe("applyPlayerMove", () => {
  beforeEach(() => {
    clearChunkDeltaMemory();
  });

  it("moves one grid step", async () => {
    const map = createDefaultRoom();
    const state = roomWithPlayer(4, 4);
    const loader = await loaderAround(4, 4);
    const grid = buildMoveGrid(map, state, "s1", loader);

    const result = applyPlayerMove(state, "s1", -1, 0, grid);
    expect(result).toEqual({ ok: true, x: 3, y: 4, facing: "w" });
  });

  it("rejects non-unit steps", async () => {
    const map = createDefaultRoom();
    const state = roomWithPlayer(4, 4);
    const loader = await loaderAround(4, 4);
    const grid = buildMoveGrid(map, state, "s1", loader);

    expect(applyPlayerMove(state, "s1", 2, 0, grid).ok).toBe(false);
  });

  it("rejects step into npc cell but updates facing", async () => {
    const map = createDefaultRoom();
    findNpc(map, "npc-1")!.x = 2;
    findNpc(map, "npc-1")!.y = 2;
    const state = roomWithPlayer(3, 2);
    state.players.get("s1")!.facing = "s";
    const loader = await loaderAround(3, 2);
    const grid = buildMoveGrid(map, state, "s1", loader);

    const result = applyPlayerMove(state, "s1", -1, 0, grid);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.facing).toBe("w");
      expect(result.facingUpdated).toBe(true);
    }
    expect(state.players.get("s1")!.x).toBe(3);
    expect(state.players.get("s1")!.y).toBe(2);
    expect(state.players.get("s1")!.facing).toBe("w");
  });

  it("allows cross-chunk step from east edge (39,0) to (40,0)", async () => {
    const map = createDefaultRoom();
    const state = roomWithPlayer(39, 0);
    const loader = await loaderAround(39, 0);
    await loader.ensureChunksForPlayers([{ gx: 40, gy: 0 }]);
    const grid = buildMoveGrid(map, state, "s1", loader);

    const result = applyPlayerMove(state, "s1", 1, 0, grid);
    expect(result).toEqual({ ok: true, x: 40, y: 0, facing: "e" });
  });

  it("rejects step into void outside homestead (unloaded chunk)", async () => {
    const map = createDefaultRoom();
    const state = roomWithPlayer(39, 4);
    const loader = new ChunkLoader({ worldId: "void-test", worldSeed: 42 });
    const grid = buildMoveGrid(map, state, "s1", loader);

    expect(applyPlayerMove(state, "s1", 1, 0, grid).ok).toBe(false);
  });
});

describe("applyPlayerMoveTo", () => {
  beforeEach(() => {
    clearChunkDeltaMemory();
  });

  it("walks full path to distant target in one update", async () => {
    const map = createDefaultRoom();
    const state = roomWithPlayer(4, 4);
    const loader = await loaderAround(4, 4);
    const grid = buildMoveGrid(map, state, "s1", loader);

    const result = applyPlayerMoveTo(state, "s1", 6, 4, grid);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.x).toBe(6);
      expect(result.y).toBe(4);
    }
  });

  it("paths from spawn to (6,4) with Beginning Fields collision", async () => {
    const map = createDefaultRoom();
    const state = roomWithPlayer(4, 4);
    const loader = await loaderAround(4, 4);
    const grid = buildMoveGrid(map, state, "s1", loader);

    const path = findGridPath(4, 4, 6, 4, grid);
    expect(path).not.toBeNull();
    const result = applyPlayerMoveTo(state, "s1", 6, 4, grid);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.x).toBe(6);
      expect(result.y).toBe(4);
    }
  });

  it("paths around closed door", async () => {
    const map = createDefaultRoom();
    map.objects = [{ id: "door-1", kind: "door", x: 3, y: 3, state: "closed" }];
    const state = roomWithPlayer(4, 4);
    const loader = await loaderAround(4, 4);
    const grid = buildMoveGrid(map, state, "s1", loader);

    const path = findGridPath(4, 4, 4, 1, grid);
    expect(path).not.toBeNull();
    expect(path!.some((c) => c.x === 3 && c.y === 3)).toBe(false);

    const result = applyPlayerMoveTo(state, "s1", 4, 1, grid);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.y).toBe(1);
    }
  });
});

describe("defaultSpawnGlobal", () => {
  it("matches Beginning Fields player spawn", () => {
    expect(defaultSpawnGlobal()).toEqual({ x: 34, y: 13 });
  });
});
