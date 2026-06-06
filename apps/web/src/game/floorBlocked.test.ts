import { describe, expect, it } from "vitest";
import { biomeAtGlobal } from "@aetherlife/shared";
import { isTerrainWalkable } from "./floorBlocked.js";

describe("isTerrainWalkable procedural fallback", () => {
  it("uses biomeAtGlobal when chunk view is not loaded", () => {
    expect(isTerrainWalkable([], 8, 0, 42)).toBe(biomeAtGlobal(8, 0, 42).walkable);
    expect(isTerrainWalkable([], 9, 0, 42)).toBe(biomeAtGlobal(9, 0, 42).walkable);
  });

  it("prefers loaded chunk tile over procedural", () => {
    const chunks = [
      {
        cx: 1,
        cy: 0,
        tiles: [{ lx: 0, ly: 0, biome: "meadow" as const, walkable: false }],
      },
    ];
    expect(isTerrainWalkable(chunks, 8, 0, 42)).toBe(false);
  });
});
