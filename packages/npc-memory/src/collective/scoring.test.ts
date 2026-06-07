import { describe, expect, it } from "vitest";
import {
  computeEffectiveScore,
  computeWitnessDeltas,
  effectiveBand,
} from "./scoring.js";

describe("npc-memory collective scoring (shared mirror)", () => {
  it("computes effective score", () => {
    expect(computeEffectiveScore(10, [0, 0])).toBe(10);
  });

  it("derives band from effective score", () => {
    expect(effectiveBand(-40, [])).toBe("hostile");
  });

  it("spreads witness deltas for loud events", () => {
    const positions = new Map([
      ["npc-1", { x: 0, y: 0 }],
      ["npc-2", { x: 1, y: 0 }],
    ]);
    const updates = computeWitnessDeltas(
      { kind: "contradict", deltaScore: -10, playerIds: ["p1"] },
      "npc-1",
      positions,
    );
    expect(updates.length).toBe(2);
  });
});
