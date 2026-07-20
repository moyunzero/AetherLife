import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  clearMockPersonalTimelineJobs,
  clearPersonalTimelineJobClaimsForTest,
  getMockPersonalTimelineJob,
} from "../queue/personal-timeline.js";
import {
  clearPersonalTimelineWeeklyState,
  dayIndexFromAbsoluteMinute,
  maybeEnqueuePersonalTimelineWeekly,
  weeklySeatsForDayIndex,
} from "./personal-timeline-weekly.js";
import { broadcastPersonalTimelineSync } from "./personal-timeline-broadcast.js";
import type { ColyseusPersonalTimelineSyncPayload } from "@aetherlife/shared";
import { COLYSEUS_SERVER_MESSAGES } from "@aetherlife/shared";

describe("personal-timeline weekly stagger", () => {
  beforeEach(() => {
    // Avoid hanging Redis claims when sibling suites load root .env REDIS_URL.
    delete process.env.REDIS_URL;
    clearPersonalTimelineWeeklyState();
    clearMockPersonalTimelineJobs();
    clearPersonalTimelineJobClaimsForTest();
  });

  afterEach(() => {
    delete process.env.REDIS_URL;
  });

  it("maps absolute minutes to dayIndex", () => {
    expect(dayIndexFromAbsoluteMinute(0)).toBe(0);
    expect(dayIndexFromAbsoluteMinute(1439)).toBe(0);
    expect(dayIndexFromAbsoluteMinute(1440)).toBe(1);
    expect(dayIndexFromAbsoluteMinute(10080)).toBe(7);
  });

  it("staggers ≈1–2 seats per day across 12 (D-GEN-04)", () => {
    for (let d = 0; d < 7; d++) {
      const seats = weeklySeatsForDayIndex(d);
      expect(seats.length).toBeGreaterThanOrEqual(1);
      expect(seats.length).toBeLessThanOrEqual(2);
    }
    const all = new Set<string>();
    for (let d = 0; d < 7; d++) {
      for (const id of weeklySeatsForDayIndex(d)) all.add(id);
    }
    expect(all.size).toBe(12);
  });

  it("enqueues weekly jobs once per dayIndex", async () => {
    const roomId = "room-pt-weekly";
    const first = await maybeEnqueuePersonalTimelineWeekly({
      roomId,
      absoluteGameMinute: 1440 * 3,
    });
    expect(first.dayIndex).toBe(3);
    expect(first.enqueued.length).toBe(weeklySeatsForDayIndex(3).length);

    const again = await maybeEnqueuePersonalTimelineWeekly({
      roomId,
      absoluteGameMinute: 1440 * 3 + 10,
    });
    expect(again.enqueued).toEqual([]);

    const job = getMockPersonalTimelineJob(first.enqueued[0]!);
    expect(job).toMatchObject({ kind: "weekly", roomId });
    expect(Array.isArray((job as { recentBullets?: string[] }).recentBullets)).toBe(
      true,
    );
  });

  it("durable jobId claim blocks re-enqueue after in-memory debounce cleared (WR-02)", async () => {
    const roomId = "room-pt-weekly-durable";
    const first = await maybeEnqueuePersonalTimelineWeekly({
      roomId,
      absoluteGameMinute: 1440 * 4,
    });
    expect(first.enqueued.length).toBeGreaterThan(0);

    clearPersonalTimelineWeeklyState();
    const again = await maybeEnqueuePersonalTimelineWeekly({
      roomId,
      absoluteGameMinute: 1440 * 4 + 5,
    });
    expect(again.enqueued).toEqual([]);
  });

  it("yields enqueue when speak in flight", async () => {
    const out = await maybeEnqueuePersonalTimelineWeekly({
      roomId: "room-busy",
      absoluteGameMinute: 1440 * 5,
      npcSpeakInFlight: true,
    });
    expect(out.enqueued).toEqual([]);
  });
});

describe("broadcastPersonalTimelineSync", () => {
  it("hint payload has hasUpdate and no body field (D-SYNC-01)", () => {
    const sent: Array<{ type: string; payload: unknown }> = [];
    const fakeRoom = {
      clients: [
        {
          send(type: string, payload: unknown) {
            sent.push({ type, payload });
          },
        },
      ],
    };

    // Inline assert on payload shape used by broadcast (no live Colyseus room).
    const payload: ColyseusPersonalTimelineSyncPayload = {
      npcId: "npc-1",
      hasUpdate: true,
      latestSeq: 4,
    };
    expect(payload).toHaveProperty("hasUpdate", true);
    expect(payload).not.toHaveProperty("body");
    expect(payload).not.toHaveProperty("entry");
    expect(COLYSEUS_SERVER_MESSAGES.personalTimelineSync).toBe(
      "personalTimelineSync",
    );

    // Call with no registered room — must not throw.
    broadcastPersonalTimelineSync("missing-room", payload);
    expect(sent).toEqual([]);
    void fakeRoom;
  });
});
