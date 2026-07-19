import { describe, expect, it } from "vitest";
import type { PersonalTimelineEntry } from "@aetherlife/shared";
import {
  clearNpcBiographyHint,
  filterPersonalTimelineEntries,
  personalTimelineSyncToasts,
  previewPersonalTimelineBody,
  reconcileHintsFromLatestSeq,
  shouldShowBiographyHint,
} from "./usePersonalTimeline.js";

function entry(
  overrides: Partial<PersonalTimelineEntry> & Pick<PersonalTimelineEntry, "id" | "tag" | "body">,
): PersonalTimelineEntry {
  return {
    roomId: "room-1",
    npcId: "npc-1",
    seq: 1,
    calendarLabel: "太乙元年·春·1月·第1日",
    source: "seed",
    createdAt: "2026-07-19T00:00:00.000Z",
    ...overrides,
  };
}

describe("filterPersonalTimelineEntries", () => {
  const rows = [
    entry({ id: "a", tag: "relationship", body: "关系条目" }),
    entry({ id: "b", tag: "council", body: "议会条目" }),
    entry({ id: "c", tag: "daily", body: "日常条目" }),
    entry({ id: "d", tag: "emotion", body: "情绪条目" }),
  ];

  it("关系 shows only tag===relationship", () => {
    expect(filterPersonalTimelineEntries(rows, "relationship").map((e) => e.id)).toEqual(["a"]);
  });

  it("议会 shows only tag===council", () => {
    expect(filterPersonalTimelineEntries(rows, "council").map((e) => e.id)).toEqual(["b"]);
  });

  it("全部 shows all", () => {
    expect(filterPersonalTimelineEntries(rows, "all").map((e) => e.id)).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
  });
});

describe("previewPersonalTimelineBody", () => {
  it("collapsed preview length is in 40–60 char range with ellipsis when longer", () => {
    const long =
      "这是一段足够长的第一人称传记正文，用来验证折叠预览会被截断到四十到六十个字符之间，并带上省略号。";
    const preview = previewPersonalTimelineBody(long);
    expect(preview.endsWith("…")).toBe(true);
    const core = preview.slice(0, -1);
    expect(core.length).toBeGreaterThanOrEqual(40);
    expect(core.length).toBeLessThanOrEqual(60);
  });

  it("short body is returned unchanged without ellipsis", () => {
    expect(previewPersonalTimelineBody("短文")).toBe("短文");
  });
});

describe("biography hint lifecycle", () => {
  it("opening biography for npcId clears that npc hasUpdate hint", () => {
    const next = clearNpcBiographyHint(
      { "npc-1": true, "npc-2": true },
      "npc-1",
    );
    expect(next["npc-1"]).toBe(false);
    expect(next["npc-2"]).toBe(true);
  });

  it("shouldShowBiographyHint when latestSeq ahead of read cursor", () => {
    expect(shouldShowBiographyHint(5, 2)).toBe(true);
    expect(shouldShowBiographyHint(2, 2)).toBe(false);
    expect(shouldShowBiographyHint(3, undefined)).toBe(true);
  });

  it("reconnect HTTP reconcile restores hints from latestSeq vs read cursors", () => {
    const hints = reconcileHintsFromLatestSeq(
      { "npc-1": 8, "npc-2": 3, "npc-3": 1 },
      { "npc-1": 5, "npc-2": 3 },
    );
    expect(hints["npc-1"]).toBe(true);
    expect(hints["npc-2"]).toBe(false);
    expect(hints["npc-3"]).toBe(true);
  });
});

describe("personalTimelineSyncToasts", () => {
  it("does not enqueue toast for personalTimelineSync", () => {
    expect(
      personalTimelineSyncToasts({
        npcId: "npc-1",
        hasUpdate: true,
        latestSeq: 4,
      }),
    ).toEqual([]);
  });
});
