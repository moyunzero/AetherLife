import { describe, expect, it } from "vitest";
import {
  NPC_ANIMATE_CATCHUP_MAX_CELLS,
  shouldSnapNpcCatchup,
} from "./gridMovement.js";

describe("shouldSnapNpcCatchup", () => {
  it("allows adjacent and short steps to animate", () => {
    expect(shouldSnapNpcCatchup(0, 0, 1, 0)).toBe(false);
    expect(shouldSnapNpcCatchup(0, 0, 0, 2)).toBe(false);
    expect(shouldSnapNpcCatchup(5, 5, 6, 6)).toBe(false);
  });

  it("snaps multi-cell cold-start / batched catch-up", () => {
    expect(shouldSnapNpcCatchup(0, 0, 3, 0)).toBe(true);
    expect(shouldSnapNpcCatchup(10, 10, 12, 12)).toBe(true);
    expect(shouldSnapNpcCatchup(0, 0, 0, NPC_ANIMATE_CATCHUP_MAX_CELLS + 1)).toBe(
      true,
    );
  });
});
