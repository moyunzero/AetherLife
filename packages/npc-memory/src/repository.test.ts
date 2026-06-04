import { describe, expect, it } from "vitest";
import { computeWeightedScore } from "./repository.js";

describe("computeWeightedScore", () => {
  it("weights higher importance memories", () => {
    const low = computeWeightedScore(0.9, 1);
    const high = computeWeightedScore(0.9, 10);
    expect(high).toBeGreaterThan(low);
  });

  it("uses default factor at importance 5", () => {
    expect(computeWeightedScore(1, 5)).toBeCloseTo(0.75, 5);
  });
});
