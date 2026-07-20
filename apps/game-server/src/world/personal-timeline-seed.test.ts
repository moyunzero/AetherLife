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

  it("seed calendarLabels are 生平·{age}; tags ∈ PERSONAL_TIMELINE_TAGS", async () => {
    await seedPersonalTimelineIfNeeded(ROOM);

    const agesSeen = new Set<string>();
    for (const npcId of COUNCIL_NPC_IDS) {
      const persona = getPersona(npcId);
      const nodes = persona.lifeNodes ?? [];
      const { entries } = await listPersonalTimelineForNpc({
        roomId: ROOM,
        npcId,
        limit: 100,
      });
      expect(entries).toHaveLength(nodes.length);
      for (const entry of entries) {
        expect(entry.calendarLabel.startsWith("生平·")).toBe(true);
        expect(entry.calendarLabel.startsWith("太乙")).toBe(false);
        expect(TAG_SET.has(entry.tag)).toBe(true);
        agesSeen.add(entry.calendarLabel);
      }
      for (const node of nodes) {
        expect(
          entries.some((e) => e.calendarLabel === `生平·${node.age}`),
        ).toBe(true);
      }
    }

    expect(agesSeen.size).toBeGreaterThan(10);
  });

  it("seed bodies are fact skeletons without shared oath boilerplate", async () => {
    await seedPersonalTimelineIfNeeded(ROOM);
    for (const npcId of COUNCIL_NPC_IDS) {
      const { entries } = await listPersonalTimelineForNpc({
        roomId: ROOM,
        npcId,
        limit: 100,
      });
      for (const entry of entries) {
        expect(entry.body).not.toContain("将此铭记于心");
        expect(entry.body).not.toContain("以为立身之基");
        expect(entry.body).toMatch(/^那年/);
        expect(entry.body.length).toBeGreaterThan(20);
      }
    }
  });

  it("repairs stale 太乙 seed labels to 生平 on re-seed", async () => {
    await seedPersonalTimelineIfNeeded(ROOM);
    const { entries: before } = await listPersonalTimelineForNpc({
      roomId: ROOM,
      npcId: "npc-1",
      limit: 10,
    });
    const first = before[0]!;
    // Simulate old D-SEED-05 stamp
    const { updatePersonalTimelineCalendarStamp } = await import(
      "./personal-timeline-repository.js"
    );
    await updatePersonalTimelineCalendarStamp({
      roomId: ROOM,
      entryId: first.id,
      calendarLabel: "太乙元年·春·1月·第1日",
      aetherEpochMinute: 0,
    });

    clearPersonalTimelineSeedCache();
    await seedPersonalTimelineIfNeeded(ROOM);

    const { entries: after } = await listPersonalTimelineForNpc({
      roomId: ROOM,
      npcId: "npc-1",
      limit: 100,
    });
    const repaired = after.find((e) => e.id === first.id);
    expect(repaired?.calendarLabel.startsWith("生平·")).toBe(true);
    expect(repaired?.calendarLabel.startsWith("太乙")).toBe(false);
  });
});
