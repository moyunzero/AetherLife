import { describe, expect, it } from "vitest";
import {
  ATTITUDE_SCORE_MAX,
  ATTITUDE_SCORE_MIN,
  bandFromEffectiveScore,
  bandLabelZh,
  clampAttitudeScore,
} from "./attitude.js";

describe("bandFromEffectiveScore", () => {
  it("maps threshold boundaries per D-15", () => {
    expect(bandFromEffectiveScore(-31)).toBe("hostile");
    expect(bandFromEffectiveScore(-30)).toBe("wary");
    expect(bandFromEffectiveScore(-1)).toBe("wary");
    expect(bandFromEffectiveScore(0)).toBe("neutral");
    expect(bandFromEffectiveScore(19)).toBe("neutral");
    expect(bandFromEffectiveScore(20)).toBe("warm");
    expect(bandFromEffectiveScore(49)).toBe("warm");
    expect(bandFromEffectiveScore(50)).toBe("allied");
  });
});

describe("bandLabelZh", () => {
  it("returns UI-SPEC locked copy", () => {
    expect(bandLabelZh("hostile")).toBe("敌意");
    expect(bandLabelZh("allied")).toBe("同盟");
  });
});

describe("clampAttitudeScore", () => {
  it("clamps to [-100, 100]", () => {
    expect(clampAttitudeScore(-200)).toBe(ATTITUDE_SCORE_MIN);
    expect(clampAttitudeScore(200)).toBe(ATTITUDE_SCORE_MAX);
  });
});
