import { describe, expect, it } from "vitest";
import {
  resolveActivityLabel,
  shouldShowActivity,
  shouldShowIntentSubline,
  truncateActivityLabel,
  truncateIntentLabel,
} from "./activityLabelLogic.js";

describe("truncateActivityLabel", () => {
  it("passes through labels within 12 chars", () => {
    expect(truncateActivityLabel("在钓鱼")).toBe("在钓鱼");
    expect(truncateActivityLabel("在与人闲聊")).toBe("在与人闲聊");
  });

  it("truncates longer labels with ellipsis", () => {
    expect(truncateActivityLabel("一二三四五六七八九零一二三")).toBe("一二三四五六七八九零一…");
  });
});

describe("truncateIntentLabel", () => {
  it("truncates intent sublines longer than 16 chars", () => {
    expect(truncateIntentLabel("一二三四五六七八九零一二三四五六七")).toBe(
      "一二三四五六七八九零一二三四五…",
    );
  });
});

describe("shouldShowActivity", () => {
  const ambient = { activityKey: "fishing" };
  const base = {
    gx: 2,
    gy: 2,
    localGx: 2,
    localGy: 3,
    npcId: "npc-1",
    ambient,
    thinkingNpcId: null as string | null,
    activeNpcId: null as string | null,
    speakBusyNpcId: null as string | null,
  };

  it("shows for proximity non-idle activity", () => {
    expect(shouldShowActivity(base)).toBe(true);
  });

  it("hides when out of proximity", () => {
    expect(shouldShowActivity({ ...base, localGx: 10, localGy: 10 })).toBe(false);
  });

  it("hides for idle or empty activityKey", () => {
    expect(shouldShowActivity({ ...base, ambient: { activityKey: "idle" } })).toBe(false);
    expect(shouldShowActivity({ ...base, ambient: { activityKey: "" } })).toBe(false);
  });

  it("hides when npc is thinking", () => {
    expect(shouldShowActivity({ ...base, thinkingNpcId: "npc-1" })).toBe(false);
  });

  it("hides when speak busy on active npc", () => {
    expect(
      shouldShowActivity({
        ...base,
        activeNpcId: "npc-1",
        speakBusyNpcId: "npc-1",
      }),
    ).toBe(false);
  });

  it("still shows when speak busy targets a different npc", () => {
    expect(
      shouldShowActivity({
        ...base,
        activeNpcId: "npc-2",
        speakBusyNpcId: "npc-2",
      }),
    ).toBe(true);
  });

  it("shows join vicinity label within 5 cells", () => {
    const now = 1_000_000;
    expect(
      resolveActivityLabel({
        ambient: {
          activityKey: "idle",
          joinVicinityActive: true,
          joinVicinityStartedAt: now,
        },
        playerDistanceCells: 4,
        npcId: "npc-1",
        thinkingNpcId: null,
        activeNpcId: null,
        speakBusyNpcId: null,
        nowMs: now + 1000,
      }),
    ).toBe("正朝你走来");
  });
});

describe("shouldShowIntentSubline", () => {
  const base = {
    intentReasonZh: "去河边看看",
    gx: 2,
    gy: 2,
    localGx: 2,
    localGy: 3,
    npcId: "npc-1",
    thinkingNpcId: null as string | null,
    activeNpcId: null as string | null,
    speakBusyNpcId: null as string | null,
    dwellMs: 1000,
    isFirstProximityThisSegment: true,
    joinVicinityActive: false,
    npcMovedSinceLastFrame: false,
  };

  it("never shows player-visible intent subline (session 5 two-line ship gate)", () => {
    expect(shouldShowIntentSubline(base)).toBe(false);
    expect(
      shouldShowIntentSubline({
        ...base,
        dwellMs: 1000,
        isFirstProximityThisSegment: true,
        intentReasonZh: "去河边看看",
      }),
    ).toBe(false);
  });
});
