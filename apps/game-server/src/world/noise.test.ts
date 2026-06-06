import { describe, expect, it } from "vitest";
import { biomeAtGlobal, generateChunkBase } from "./noise.js";

describe("generateChunkBase", () => {
  it("is deterministic for the same seed", () => {
    const a = generateChunkBase(1, 0, 42);
    const b = generateChunkBase(1, 0, 42);
    expect(a).toEqual(b);
  });

  it("home chunk (0,0) is all home biome walkable", () => {
    const base = generateChunkBase(0, 0, 42);
    expect(base.tiles).toHaveLength(64);
    for (const t of base.tiles) {
      expect(t.biome).toBe("home");
      expect(t.walkable).toBe(true);
    }
  });

  it("seed=42 snapshot cells (0,0), (8,0), (9,0)", () => {
    expect(biomeAtGlobal(0, 0, 42)).toEqual({ biome: "home", walkable: true });
    expect(biomeAtGlobal(8, 0, 42)).toEqual({ biome: "scrub", walkable: true });
    expect(biomeAtGlobal(9, 0, 42)).toEqual({ biome: "wetland", walkable: true });
  });
});
