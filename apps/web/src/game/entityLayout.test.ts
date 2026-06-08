import { describe, expect, it } from "vitest";
import { ENTITY_DEPTH_BASE, entityDepth } from "./entityLayout.js";

const FLOOR_DEPTH_MAX = 2;

describe("entityDepth", () => {
  it("stays above floor layers when gy is negative (explore north)", () => {
    const d = entityDepth(5, -11, 2);
    expect(d).toBeGreaterThan(FLOOR_DEPTH_MAX);
    expect(d).toBe(ENTITY_DEPTH_BASE + -11 * 10 + 5 + 2);
  });

  it("preserves y-sort ordering for two cells in the same column", () => {
    expect(entityDepth(3, 4, 1)).toBeLessThan(entityDepth(3, 5, 1));
  });

  it("renders entities above foot-aligned decor on the same cell", () => {
    expect(entityDepth(4, 6, 0)).toBeLessThan(entityDepth(4, 6, 1));
  });
});
