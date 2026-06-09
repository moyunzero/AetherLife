import { describe, expect, it } from "vitest";
import { biomeAtGlobal } from "@aetherlife/shared";
import { isTerrainWalkable } from "./floorBlocked.js";

describe("isTerrainWalkable procedural fallback", () => {
  it("uses biomeAtGlobal when chunk view is not loaded outside homestead", () => {
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

  it("Beginning Fields homestead region (40×40) is terrain-walkable regardless of chunk tile", () => {
    const chunks = [
      {
        cx: 1,
        cy: 0,
        tiles: [{ lx: 0, ly: 0, biome: "wetland" as const, walkable: false }],
      },
    ];
    expect(isTerrainWalkable(chunks, 8, 0, 42)).toBe(true);
    expect(isTerrainWalkable([], 20, 20, 42)).toBe(true);
    expect(isTerrainWalkable([], 39, 39, 42)).toBe(true);
    expect(isTerrainWalkable([], 40, 0, 42)).toBe(biomeAtGlobal(40, 0, 42).walkable);
  });
});
