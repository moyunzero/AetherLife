import { describe, expect, it } from "vitest";
import {
  NPC_ACTIVITY_KEYS,
  activityDisplayZh,
  formatGameClock,
  isKnownActivityKey,
} from "./npcActivity.js";

describe("NPC_ACTIVITY_KEYS", () => {
  it("includes all 10 MVP keys plus unknown", () => {
    expect(NPC_ACTIVITY_KEYS).toEqual([
      "idle",
      "patrol",
      "fishing",
      "tending_crops",
      "watering",
      "chopping_wood",
      "reading",
      "cooking",
      "socializing",
      "resting",
      "unknown",
    ]);
  });
});

describe("activityDisplayZh", () => {
  it('returns "在钓鱼" for fishing', () => {
    expect(activityDisplayZh("fishing")).toBe("在钓鱼");
  });

  it("returns empty string for idle", () => {
    expect(activityDisplayZh("idle")).toBe("");
  });

  it('returns unknown fallback "在忙别的" for bogus keys', () => {
    expect(activityDisplayZh("bogus")).toBe("在忙别的");
  });
});

describe("formatGameClock", () => {
  it("formats 6:00 and 14:30", () => {
    expect(formatGameClock(360)).toBe("06:00");
    expect(formatGameClock(870)).toBe("14:30");
  });

  it("wraps minutes outside 0–1439", () => {
    expect(formatGameClock(1440)).toBe("00:00");
    expect(formatGameClock(-60)).toBe("23:00");
  });
});

describe("isKnownActivityKey", () => {
  it("accepts MVP keys and rejects bogus", () => {
    expect(isKnownActivityKey("reading")).toBe(true);
    expect(isKnownActivityKey("bogus")).toBe(false);
  });
});
