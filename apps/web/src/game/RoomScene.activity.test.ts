import { describe, expect, it } from "vitest";
import { shouldShowActivity, truncateActivityLabel } from "./activityLabelLogic.js";

describe("truncateActivityLabel", () => {
  it("passes through labels within 12 chars", () => {
    expect(truncateActivityLabel("在钓鱼")).toBe("在钓鱼");
    expect(truncateActivityLabel("在与人闲聊")).toBe("在与人闲聊");
  });

  it("truncates longer labels with ellipsis", () => {
    expect(truncateActivityLabel("一二三四五六七八九零一二三")).toBe("一二三四五六七八九零一…");
  });
});

describe("shouldShowActivity", () => {
  const base = {
    gx: 2,
    gy: 2,
    localGx: 2,
    localGy: 3,
    npcId: "npc-1",
    activityKey: "fishing",
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
    expect(shouldShowActivity({ ...base, activityKey: "idle" })).toBe(false);
    expect(shouldShowActivity({ ...base, activityKey: "" })).toBe(false);
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
});
