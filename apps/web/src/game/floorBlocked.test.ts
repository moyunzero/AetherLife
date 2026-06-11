import { describe, expect, it } from "vitest";
import {
  CHUNK_SIZE,
  biomeAtGlobal,
  chunkOf,
  defaultBeginningFieldsBundle,
  loadWorldRegistry,
  type ChunkView,
} from "@aetherlife/shared";
import { isTerrainWalkable } from "./floorBlocked.js";
import { regionWalkabilityAt } from "./regionCollision.js";

describe("isTerrainWalkable procedural fallback", () => {
  it("uses biomeAtGlobal when chunk view is not loaded outside homestead", () => {
    loadWorldRegistry(defaultBeginningFieldsBundle());
    expect(isTerrainWalkable([], 40, 0, 42)).toBe(biomeAtGlobal(40, 0, 42).walkable);
    expect(isTerrainWalkable([], 41, 0, 42)).toBe(biomeAtGlobal(41, 0, 42).walkable);
  });

  it("prefers loaded chunk tile over procedural outside homestead", () => {
    const chunks = [
      {
        cx: 5,
        cy: 0,
        tiles: [{ lx: 0, ly: 0, biome: "meadow" as const, walkable: false }],
      },
    ];
    expect(isTerrainWalkable(chunks, 40, 0, 42)).toBe(false);
  });

  it("Beginning Fields uses baked Collision layer grid (not all-walkable)", () => {
    loadWorldRegistry(defaultBeginningFieldsBundle());
    expect(isTerrainWalkable([], 34, 13, 42)).toBe(true);
    expect(isTerrainWalkable([], 28, 8, 42)).toBe(false);
    expect(regionWalkabilityAt(28, 8)).toBe(false);
    expect(isTerrainWalkable([], 40, 0, 42)).toBe(biomeAtGlobal(40, 0, 42).walkable);
  });
});
