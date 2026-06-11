import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDefaultRoom, loadWorldRegistry, setWorldRegistry, type WorldRegionId } from "@aetherlife/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { buildMoveGrid, findGridPath } from "../colyseus/move-handler.js";
import { GameRoomState, PlayerSchema } from "../colyseus/schema.js";
import { clearChunkDeltaMemory } from "./chunk-repository.js";
import { ChunkLoader } from "./chunk-loader.js";
import {
  isTerrainWalkableInRegion,
  registerRegionCollision,
  resetRegionWalkabilityForTests,
} from "./region-walkability.js";

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../data/world");

function bootWorldFromDisk(): void {
  resetRegionWalkabilityForTests();
  setWorldRegistry(null);

  const regionsFile = JSON.parse(readFileSync(join(DATA_DIR, "regions.json"), "utf8")) as {
    regions: Array<{ id: string }>;
  };
  const zonesByRegionId: Record<string, unknown> = {};
  const poisByRegionId: Record<string, unknown> = {};
  const spawnsByRegionId: Record<string, unknown> = {};

  for (const region of regionsFile.regions) {
    const regionDir = join(DATA_DIR, region.id);
    zonesByRegionId[region.id] = JSON.parse(readFileSync(join(regionDir, "zones.json"), "utf8"));
    poisByRegionId[region.id] = JSON.parse(readFileSync(join(regionDir, "pois.json"), "utf8"));
    spawnsByRegionId[region.id] = JSON.parse(
      readFileSync(join(regionDir, "spawns.json"), "utf8"),
    );
    const collisionPath = join(regionDir, "collision.json");
    if (existsSync(collisionPath)) {
      registerRegionCollision(
        region.id as WorldRegionId,
        JSON.parse(readFileSync(collisionPath, "utf8")),
      );
    }
  }

  loadWorldRegistry({
    regions: regionsFile,
    zonesByRegionId,
    poisByRegionId,
    spawnsByRegionId,
  });
}

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
  const loader = new ChunkLoader({ worldId: "cross-region-test", worldSeed: 42 });
  await loader.ensureChunksForPlayers([{ gx, gy }]);
  return loader;
}

describe("cross-region pathfind", () => {
  beforeEach(() => {
    clearChunkDeltaMemory();
    bootWorldFromDisk();
  });

  it("陆桥 transition cells (39,20) and (40,20) are walkable", () => {
    expect(isTerrainWalkableInRegion(39, 20)).toBe(true);
    expect(isTerrainWalkableInRegion(40, 20)).toBe(true);
  });

  it("finds path from beginning-fields (10,10) to village-plaza fountain (50,10)", async () => {
    const fromX = 10;
    const fromY = 10;
    const toX = 50;
    const toY = 10;

    const map = createDefaultRoom();
    const state = roomWithPlayer(fromX, fromY);
    const loader = await loaderAround(fromX, fromY);
    await loader.ensureChunksForPlayers([{ gx: toX, gy: toY }]);
    const grid = buildMoveGrid(map, state, "s1", loader);

    expect(grid.isTerrainWalkable(fromX, fromY)).toBe(true);
    expect(grid.isTerrainWalkable(toX, toY)).toBe(true);

    const path = findGridPath(fromX, fromY, toX, toY, grid);
    expect(path).not.toBeNull();
    expect(path!.length).toBeGreaterThan(1);
    expect(path!.length).toBeLessThan(100);

    for (const step of path!) {
      expect(grid.isTerrainWalkable(step.x, step.y)).toBe(true);
      expect(grid.isBlocked(step.x, step.y)).toBe(false);
    }

    const crossedEast = path!.some((step) => step.x >= 40);
    expect(crossedEast).toBe(true);
  });
});
