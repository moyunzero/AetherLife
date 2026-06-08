import { describe, expect, it } from "vitest";
import {
  minuteInSegment,
  resolveScheduleSegment,
  validateActivityKey,
  loadedScheduleCount,
} from "./schedule.js";

describe("validateActivityKey", () => {
  it("coerces unknown keys to idle", () => {
    expect(validateActivityKey("reading")).toBe("reading");
    expect(validateActivityKey("bogus")).toBe("idle");
  });
});

describe("minuteInSegment", () => {
  it("handles midnight wrap (toMinute < fromMinute)", () => {
    expect(minuteInSegment(1300, 1200, 360)).toBe(true);
    expect(minuteInSegment(200, 1200, 360)).toBe(true);
    expect(minuteInSegment(360, 1200, 360)).toBe(false);
  });
});

describe("resolveScheduleSegment", () => {
  it("loads three persona schedule files at module init", () => {
    expect(loadedScheduleCount()).toBe(3);
  });

  it("returns reading segment for npc-1 at 6:00 (360)", () => {
    const segment = resolveScheduleSegment("npc-1", 360);
    expect(segment).not.toBeNull();
    expect(segment!.activityKey).toBe("reading");
    expect(segment!.stationary).toBe(true);
  });

  it("switches activity at segment boundary 480", () => {
    expect(resolveScheduleSegment("npc-1", 479)?.activityKey).toBe("reading");
    expect(resolveScheduleSegment("npc-1", 480)?.activityKey).toBe("patrol");
  });

  it("resolves midnight wrap resting segment before 6:00", () => {
    expect(resolveScheduleSegment("npc-1", 300)?.activityKey).toBe("resting");
  });

  it("returns null for unknown npc id", () => {
    expect(resolveScheduleSegment("npc-99", 360)).toBeNull();
  });
});
