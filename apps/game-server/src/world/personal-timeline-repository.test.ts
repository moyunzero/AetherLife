import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearPersonalTimelineMemory,
  computeProposalEligible,
  insertPersonalTimelineEntry,
  listPersonalTimelineForNpc,
} from "./personal-timeline-repository.js";

const ROOM = "room-pt";
const NPC_A = "npc-1";
const NPC_B = "npc-2";

function baseInput(
  overrides: Partial<Parameters<typeof insertPersonalTimelineEntry>[0]> = {},
): Parameters<typeof insertPersonalTimelineEntry>[0] {
  return {
    roomId: ROOM,
    npcId: NPC_A,
    calendarLabel: "太乙元年·春·1月·第1日",
    aetherEpochMinute: 0,
    tag: "daily",
    body: "今日我在田埂边走过。",
    source: "seed",
    ...overrides,
  };
}

describe("personal-timeline-repository", () => {
  beforeEach(() => {
    delete process.env.DATABASE_URL;
    clearPersonalTimelineMemory();
  });

  afterEach(() => {
    delete process.env.DATABASE_URL;
    clearPersonalTimelineMemory();
  });

  it("insert then list returns entry with seq, calendarLabel, tag, body for that npcId only", async () => {
    const inserted = await insertPersonalTimelineEntry(
      baseInput({
        body: "我记得初到此间的晨雾。",
        tag: "reflection",
      }),
    );

    expect(inserted.seq).toBe(1);
    expect(inserted.calendarLabel).toBe("太乙元年·春·1月·第1日");
    expect(inserted.tag).toBe("reflection");
    expect(inserted.body).toBe("我记得初到此间的晨雾。");
    expect(inserted.npcId).toBe(NPC_A);

    await insertPersonalTimelineEntry(
      baseInput({
        npcId: NPC_B,
        body: "另一席的独白不应混入列表。",
      }),
    );

    const listed = await listPersonalTimelineForNpc({
      roomId: ROOM,
      npcId: NPC_A,
    });
    expect(listed.entries).toHaveLength(1);
    expect(listed.entries[0]!.id).toBe(inserted.id);
    expect(listed.entries[0]!.body).toBe("我记得初到此间的晨雾。");
    expect(listed.entries.every((e) => e.npcId === NPC_A)).toBe(true);
  });

  it("second insert increments per-(roomId,npcId) seq", async () => {
    const first = await insertPersonalTimelineEntry(baseInput());
    const second = await insertPersonalTimelineEntry(
      baseInput({
        calendarLabel: "太乙元年·春·1月·第2日",
        aetherEpochMinute: 1440,
        body: "翌日我仍在此耕作。",
      }),
    );
    const otherNpc = await insertPersonalTimelineEntry(
      baseInput({
        npcId: NPC_B,
        body: "他席独立序号。",
      }),
    );

    expect(first.seq).toBe(1);
    expect(second.seq).toBe(2);
    expect(otherNpc.seq).toBe(1);
  });

  it("proposalEligible true for relationship|council|eventAnchorId; false for seed daily without anchor", async () => {
    expect(
      computeProposalEligible({ tag: "daily", eventAnchorId: undefined }),
    ).toBe(false);
    expect(
      computeProposalEligible({ tag: "relationship", eventAnchorId: undefined }),
    ).toBe(true);
    expect(
      computeProposalEligible({ tag: "council", eventAnchorId: undefined }),
    ).toBe(true);
    expect(
      computeProposalEligible({ tag: "daily", eventAnchorId: "anchor-1" }),
    ).toBe(true);

    const daily = await insertPersonalTimelineEntry(baseInput({ tag: "daily" }));
    expect(daily.proposalEligible).toBe(false);

    const rel = await insertPersonalTimelineEntry(
      baseInput({ tag: "relationship", body: "我与邻席交谈甚欢。" }),
    );
    expect(rel.proposalEligible).toBe(true);

    const anchored = await insertPersonalTimelineEntry(
      baseInput({
        tag: "adventure",
        eventAnchorId: "evt-shared-1",
        factualSummary: "广场议事",
        body: "我见证了广场上的喧哗。",
      }),
    );
    expect(anchored.proposalEligible).toBe(true);
  });

  it("isolation: repository source never targets npc_memories / __council__ / appendPlayerMemory", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, "personal-timeline-repository.ts"), "utf8");

    expect(src).not.toMatch(/appendPlayerMemory/);
    expect(src).not.toMatch(/__council__/);
    expect(src).not.toMatch(/npc_memories/);
    expect(src).toMatch(/npc_personal_timeline/);
  });
});
