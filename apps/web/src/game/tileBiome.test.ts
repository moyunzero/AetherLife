import { describe, expect, it } from "vitest";
import { biomeBaseIndex, pickFloorVariant, tileIndexFor, voidTileIndexFor } from "./tileBiome.js";

describe("tileBiome", () => {
  it("home vs meadow walkable indices differ at same cell", () => {
    const gx = 4;
    const gy = 7;
    const home = tileIndexFor("home", true, gx, gy);
    const meadow = tileIndexFor("meadow", true, gx, gy);
    expect(home).not.toBe(meadow);
    expect(home).toBeGreaterThanOrEqual(biomeBaseIndex("home"));
    expect(meadow).toBeGreaterThanOrEqual(biomeBaseIndex("meadow"));
  });

  it("pickFloorVariant is stable and in 0..3", () => {
    const v = pickFloorVariant(12, 34);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(4);
    expect(pickFloorVariant(12, 34)).toBe(v);
  });

  it("blocked uses base + 4", () => {
    const gx = 1;
    const gy = 2;
    const blocked = tileIndexFor("scrub", false, gx, gy);
    expect(blocked).toBe(biomeBaseIndex("scrub") + 4);
  });

  it("voidTileIndexFor returns blocked highland or scrub", () => {
    const idx = voidTileIndexFor(3, 5);
    expect(idx).toBeGreaterThanOrEqual(biomeBaseIndex("scrub"));
    expect([biomeBaseIndex("highland") + 4, biomeBaseIndex("scrub") + 4]).toContain(idx);
  });
});
