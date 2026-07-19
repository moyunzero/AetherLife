import { beforeEach, describe, expect, it } from "vitest";
import {
  COUNCIL_NPC_IDS,
  getPersona,
  PERSONAL_TIMELINE_TAGS,
} from "@aetherlife/shared";
import {
  clearPersonalTimelineMemory,
  listPersonalTimelineForNpc,
} from "./personal-timeline-repository.js";
import {
  clearPersonalTimelineSeedCache,
  seedPersonalTimelineIfNeeded,
} from "./personal-timeline-seed.js";

const ROOM = "room-pt-seed";
const TAG_SET = new Set<string>(PERSONAL_TIMELINE_TAGS);

describe("seedPersonalTimelineIfNeeded (D-SEED-02/03/05)", () => {
  beforeEach(() => {
    delete process.env.DATABASE_URL;
    clearPersonalTimelineMemory();
    clearPersonalTimelineSeedCache();
  });

  it("inserts 1:1 seed entry per lifeNode for every council npc", async () => {
    await seedPersonalTimelineIfNeeded(ROOM);

    for (const npcId of COUNCIL_NPC_IDS) {
      const persona = getPersona(npcId);
      const expected = persona.lifeNodes?.length ?? 0;
      expect(expected).toBeGreaterThan(0);

      const { entries } = await listPersonalTimelineForNpc({
        roomId: ROOM,
        npcId,
        limit: 100,
      });
      expect(entries).toHaveLength(expected);
      expect(entries.every((e) => e.source === "seed")).toBe(true);
      expect(entries.every((e) => e.npcId === npcId)).toBe(true);
    }
  });

  it("second call is idempotent (no duplicate seeds)", async () => {
    await seedPersonalTimelineIfNeeded(ROOM);
    const countsBefore = await Promise.all(
      COUNCIL_NPC_IDS.map(async (npcId) => {
        const { entries } = await listPersonalTimelineForNpc({
          roomId: ROOM,
          npcId,
          limit: 100,
        });
        return entries.length;
      }),
    );

    await seedPersonalTimelineIfNeeded(ROOM);

    for (let i = 0; i < COUNCIL_NPC_IDS.length; i++) {
      const npcId = COUNCIL_NPC_IDS[i]!;
      const { entries } = await listPersonalTimelineForNpc({
        roomId: ROOM,
        npcId,
        limit: 100,
      });
      expect(entries).toHaveLength(countsBefore[i]!);
    }
  });

  it("seed calendarLabels are year-0 with 月; tags ∈ PERSONAL_TIMELINE_TAGS", async () => {
    await seedPersonalTimelineIfNeeded(ROOM);

    const monthsSeen = new Set<number>();
    for (const npcId of COUNCIL_NPC_IDS) {
      const { entries } = await listPersonalTimelineForNpc({
        roomId: ROOM,
        npcId,
        limit: 100,
      });
      for (const entry of entries) {
        expect(entry.calendarLabel.startsWith("太乙元年")).toBe(true);
        expect(entry.calendarLabel).toMatch(/\d+月/);
        expect(TAG_SET.has(entry.tag)).toBe(true);

        const monthMatch = entry.calendarLabel.match(/(\d+)月/);
        expect(monthMatch).not.toBeNull();
        const month = Number(monthMatch![1]);
        expect(month).toBeGreaterThanOrEqual(1);
        expect(month).toBeLessThanOrEqual(12);
        monthsSeen.add(month);
      }
    }

    // D-SEED-05: stamps spread across 太乙元年 months 1–12 (not all month 1)
    expect(monthsSeen.size).toBeGreaterThanOrEqual(8);
    expect(monthsSeen.has(1)).toBe(true);
    expect(monthsSeen.has(12) || monthsSeen.has(11) || monthsSeen.has(10)).toBe(
      true,
    );
  });
});
