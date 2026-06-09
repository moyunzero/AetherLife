import { describe, expect, it } from "vitest";
import { biomeAtGlobal } from "@aetherlife/shared";
import { isTerrainWalkable } from "./floorBlocked.js";

describe("isTerrainWalkable procedural fallback", () => {
  it("uses biomeAtGlobal when chunk view is not loaded outside homestead", () => {
    expect(isTerrainWalkable([], 24, 0, 42)).toBe(biomeAtGlobal(24, 0, 42).walkable);
    expect(isTerrainWalkable([], 25, 0, 42)).toBe(biomeAtGlobal(25, 0, 42).walkable);
  });

  it("prefers loaded chunk tile over procedural outside homestead", () => {
    const chunks = [
      {
        cx: 3,
        cy: 0,
        tiles: [{ lx: 0, ly: 0, biome: "meadow" as const, walkable: false }],
      },
    ];
    expect(isTerrainWalkable(chunks, 24, 0, 42)).toBe(false);
  });

  it("map-test homestead region (24×24) is terrain-walkable regardless of chunk tile", () => {
    const chunks = [
      {
        cx: 1,
        cy: 0,
        tiles: [{ lx: 0, ly: 0, biome: "wetland" as const, walkable: false }],
      },
    ];
    expect(isTerrainWalkable(chunks, 8, 0, 42)).toBe(true);
    expect(isTerrainWalkable([], 20, 20, 42)).toBe(true);
    expect(isTerrainWalkable([], 24, 0, 42)).toBe(biomeAtGlobal(24, 0, 42).walkable);
  });
});
