import { describe, expect, it } from "vitest";
import {
  DECOR_TINT,
  FLOOR_LAYER_TINT,
  WETLAND_DECOR_TINT,
  WETLAND_FLOOR_TINT,
  decorTintForPlacement,
  tintForBiome,
} from "./pastoralTint.js";

describe("pastoralTint", () => {
  it("wetland floor tint differs from home pastoral warmth", () => {
    expect(tintForBiome("wetland")).toBe(WETLAND_FLOOR_TINT);
    expect(tintForBiome("home")).toBe(FLOOR_LAYER_TINT);
    expect(WETLAND_FLOOR_TINT).not.toBe(FLOOR_LAYER_TINT);
  });

  it("homestead chunk decor uses warm DECOR_TINT", () => {
    expect(decorTintForPlacement("home", 0, 0)).toBe(DECOR_TINT);
  });

  it("wetland decor uses softened green tint", () => {
    expect(decorTintForPlacement("wetland", 1, 0)).toBe(WETLAND_DECOR_TINT);
  });
});
