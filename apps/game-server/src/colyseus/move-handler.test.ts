import { createDefaultRoom, defaultSpawnGlobal } from "@aetherlife/shared";
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

    const result = applyPlayerMove(state, "s1", 1, 0, grid);
    expect(result).toEqual({ ok: true, x: 5, y: 4, facing: "e" });
  });

  it("rejects non-unit steps", async () => {
    const map = createDefaultRoom();
    const state = roomWithPlayer(4, 4);
    const loader = await loaderAround(4, 4);
    const grid = buildMoveGrid(map, state, "s1", loader);

    expect(applyPlayerMove(state, "s1", 2, 0, grid).ok).toBe(false);
  });

  it("rejects step into npc cell", async () => {
    const map = createDefaultRoom();
    const state = roomWithPlayer(3, 2);
    const loader = await loaderAround(3, 2);
    const grid = buildMoveGrid(map, state, "s1", loader);

    expect(applyPlayerMove(state, "s1", -1, 0, grid).ok).toBe(false);
  });

  it("allows cross-chunk step (7,0) to (8,0)", async () => {
    const map = createDefaultRoom();
    const state = roomWithPlayer(7, 0);
    const loader = await loaderAround(7, 0);
    await loader.ensureChunksForPlayers([{ gx: 8, gy: 0 }]);
    const grid = buildMoveGrid(map, state, "s1", loader);

    const result = applyPlayerMove(state, "s1", 1, 0, grid);
    expect(result).toEqual({ ok: true, x: 8, y: 0, facing: "e" });
  });

  it("rejects step into void (unloaded chunk)", async () => {
    const map = createDefaultRoom();
    const state = roomWithPlayer(4, 4);
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
    expect(result).toEqual({ ok: true, x: 6, y: 4, facing: "e" });
  });

  it("paths from spawn to (7,0) for cross-chunk verify", async () => {
    const map = createDefaultRoom();
    const state = roomWithPlayer(4, 4);
    const loader = await loaderAround(4, 4);
    const grid = buildMoveGrid(map, state, "s1", loader);

    const path = findGridPath(4, 4, 7, 0, grid);
    expect(path).not.toBeNull();
    const result = applyPlayerMoveTo(state, "s1", 7, 0, grid);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.x).toBe(7);
      expect(result.y).toBe(0);
    }
  });

  it("paths around closed door", async () => {
    const map = createDefaultRoom();
    map.objects[0]!.state = "closed";
    const state = roomWithPlayer(4, 4);
    const loader = await loaderAround(4, 4);
    const grid = buildMoveGrid(map, state, "s1", loader);

    const path = findGridPath(4, 4, 4, 0, grid);
    expect(path).not.toBeNull();
    expect(path!.some((c) => c.x === 3 && c.y === 3)).toBe(false);

    const result = applyPlayerMoveTo(state, "s1", 4, 0, grid);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.y).toBe(0);
    }
  });
});

describe("defaultSpawnGlobal", () => {
  it("matches legacy spawn", () => {
    expect(defaultSpawnGlobal()).toEqual({ x: 4, y: 4 });
  });
});
