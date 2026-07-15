import { describe, expect, it } from "vitest";
import { BEGINNING_FIELDS_ID, COUNCIL_NPC_IDS, defaultBeginningFieldsBundle, getPersona, loadWorldRegistry } from "@aetherlife/shared";
import {
  getNpcSchedule,
  isLingerMobility,
  minuteInSegment,
  resolveScheduleSegment,
  shouldSkipMovement,
  validateActivityKey,
  validateNpcSchedulesAgainstRegistry,
  loadedScheduleCount,
} from "./schedule.js";

describe("shouldSkipMovement / isLingerMobility", () => {
  it("skips only resting (idle schedules walk as wander)", () => {
    expect(
      shouldSkipMovement({
        fromMinute: 0,
        toMinute: 360,
        activityKey: "resting",
        zoneId: "beginning-fields@v1:orchard",
        mobility: "stationary",
      }),
    ).toBe(true);
    expect(
      shouldSkipMovement({
        fromMinute: 360,
        toMinute: 720,
        activityKey: "idle",
        zoneId: "beginning-fields@v1:plaza",
        mobility: "wander",
      }),
    ).toBe(false);
    expect(
      shouldSkipMovement({
        fromMinute: 360,
        toMinute: 480,
        activityKey: "reading",
        zoneId: "beginning-fields@v1:orchard",
        mobility: "stationary",
      }),
    ).toBe(false);
  });

  it("linger applies to stationary and poi mobility", () => {
    expect(isLingerMobility("stationary")).toBe(true);
    expect(isLingerMobility("poi")).toBe(true);
    expect(isLingerMobility("wander")).toBe(false);
  });
});

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
  it("loads twelve council schedule files at module init", () => {
    expect(loadedScheduleCount()).toBe(12);
  });

  it("each loaded schedule persona matches registry archetype slug", () => {
    for (const npcId of COUNCIL_NPC_IDS) {
      const schedule = getNpcSchedule(npcId);
      expect(schedule, `missing schedule for ${npcId}`).toBeDefined();
      expect(schedule!.persona).toBe(getPersona(npcId).archetype);
    }
  });

  it("returns reading segment for npc-1 at 6:00 (360)", () => {
    const segment = resolveScheduleSegment("npc-1", 360);
    expect(segment).not.toBeNull();
    expect(segment!.activityKey).toBe("reading");
    expect(segment!.mobility).toBe("stationary");
    expect(segment!.zoneId).toBe("beginning-fields@v1:orchard");
  });

  it("switches activity at segment boundary 480", () => {
    expect(resolveScheduleSegment("npc-1", 479)?.activityKey).toBe("reading");
    expect(resolveScheduleSegment("npc-1", 480)?.activityKey).toBe("patrol");
    expect(resolveScheduleSegment("npc-1", 480)?.mobility).toBe("wander");
  });

  it("resolves midnight wrap resting segment before 6:00", () => {
    expect(resolveScheduleSegment("npc-1", 300)?.activityKey).toBe("resting");
  });

  it("returns null for unknown npc id", () => {
    expect(resolveScheduleSegment("npc-99", 360)).toBeNull();
  });
});

describe("validateNpcSchedulesAgainstRegistry (T-16-01)", () => {
  it("throws when a segment zoneId is absent from WorldRegistry", () => {
    const bundle = defaultBeginningFieldsBundle();
    const zones = bundle.zonesByRegionId[BEGINNING_FIELDS_ID] as {
      zones: Array<{ id: string }>;
    };
    zones.zones = zones.zones.filter((z) => z.id !== "orchard");
    const registry = loadWorldRegistry(bundle);
    expect(() => validateNpcSchedulesAgainstRegistry(registry)).toThrow(
      /unknown zoneId beginning-fields@v1:orchard/,
    );
  });
});

describe("hybrid persona schedules (D-zone-persona-hybrid)", () => {
  it("npc-1 has AM orchard linger then home wander patrol", () => {
    const schedule = getNpcSchedule("npc-1")!;
    const morning = schedule.segments.find((s) => s.fromMinute === 360)!;
    expect(morning.mobility).toBe("stationary");
    expect(morning.zoneId).toBe("beginning-fields@v1:orchard");
    const day = schedule.segments.find((s) => s.fromMinute === 480)!;
    expect(day.mobility).toBe("wander");
    expect(day.zoneId).toBe("beginning-fields@v1:home");
  });

  it("npc-2 expansionist has AM orchard stationary and day home roam", () => {
    const schedule = getNpcSchedule("npc-2")!;
    expect(schedule.persona).toBe("expansionist");
    const morning = schedule.segments.find((s) => s.fromMinute === 360)!;
    expect(morning.mobility).toBe("stationary");
    expect(morning.zoneId).toBe("beginning-fields@v1:orchard");
    const day = schedule.segments.find((s) => s.fromMinute === 480)!;
    expect(day.mobility).toBe("wander");
    expect(day.zoneId).toBe("beginning-fields@v1:home");
  });

  it("npc-3 logician has midday plaza socialize poi", () => {
    const schedule = getNpcSchedule("npc-3")!;
    expect(schedule.persona).toBe("logician");
    const socialize = schedule.segments.find((s) => s.activityKey === "socializing")!;
    expect(socialize.mobility).toBe("poi");
    expect(socialize.zoneId).toBe("beginning-fields@v1:plaza");
  });

  it("every council seat has at least one beginning-fields@v1:home wander segment", () => {
    for (const id of COUNCIL_NPC_IDS) {
      const schedule = getNpcSchedule(id)!;
      expect(
        schedule.segments.some(
          (s) => s.zoneId === "beginning-fields@v1:home" && s.mobility === "wander",
        ),
        `${id} should roam home`,
      ).toBe(true);
    }
  });
});
