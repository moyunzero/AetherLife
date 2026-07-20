import { describe, expect, it } from "vitest";
import {
  aetherCivilFromEpochMinute,
  computeProposalEligible,
  formatAetherCalendarLabel,
  formatLifetimeCalendarLabel,
  isAetherCalendarLabel,
  isLifetimeCalendarLabel,
  lifetimeEpochMinute,
  LIFETIME_EPOCH_MINUTE_BASE,
} from "./personalTimeline.js";

describe("aetherCivilFromEpochMinute", () => {
  it("epoch 0 → year 0, 春, month 1, dayOfMonth 1, minuteOfDay 0", () => {
    expect(aetherCivilFromEpochMinute(0)).toEqual({
      year: 0,
      season: "春",
      month: 1,
      dayOfMonth: 1,
      minuteOfDay: 0,
      dayIndex: 0,
    });
  });

  it("epoch 1440 → dayIndex 1 still year 0 month 1 day 2 (not year bump)", () => {
    expect(aetherCivilFromEpochMinute(1440)).toMatchObject({
      year: 0,
      season: "春",
      month: 1,
      dayOfMonth: 2,
      minuteOfDay: 0,
      dayIndex: 1,
    });
  });

  it("epoch 1440*360 → year 1", () => {
    expect(aetherCivilFromEpochMinute(1440 * 360)).toMatchObject({
      year: 1,
      season: "春",
      month: 1,
      dayOfMonth: 1,
      dayIndex: 360,
      minuteOfDay: 0,
    });
  });
});

describe("formatAetherCalendarLabel (month-aware)", () => {
  it("year 0 label includes month per D-CAL-04", () => {
    const label = formatAetherCalendarLabel(0, "春", 1, 1);
    expect(label).toContain("月");
    expect(label).toBe("太乙元年·春·1月·第1日");
  });

  it("year N label includes month", () => {
    expect(formatAetherCalendarLabel(3, "秋", 9, 15)).toBe("太乙3年·秋·9月·第15日");
  });
});

describe("computeProposalEligible (D-PROP-01)", () => {
  it("seed source is never proposal-eligible (BIO-07 / WR-03)", () => {
    expect(
      computeProposalEligible({
        tag: "council",
        eventAnchorId: "life-node:npc-1:0",
        source: "seed",
      }),
    ).toBe(false);
    expect(
      computeProposalEligible({
        tag: "council",
        eventAnchorId: "wh-1",
        source: "llm_event",
      }),
    ).toBe(true);
  });
});

describe("lifetime calendar (pre-arrival)", () => {
  it("formatLifetimeCalendarLabel uses 生平· prefix, not 太乙", () => {
    expect(formatLifetimeCalendarLabel("16岁")).toBe("生平·16岁");
    expect(formatLifetimeCalendarLabel("派驻后")).toBe("生平·派驻后");
    expect(isLifetimeCalendarLabel("生平·16岁")).toBe(true);
    expect(isAetherCalendarLabel("生平·16岁")).toBe(false);
    expect(isAetherCalendarLabel("太乙元年·春·1月·第1日")).toBe(true);
  });

  it("lifetimeEpochMinute is always before Aether epoch 0", () => {
    expect(lifetimeEpochMinute(0)).toBe(LIFETIME_EPOCH_MINUTE_BASE);
    expect(lifetimeEpochMinute(4)).toBe(LIFETIME_EPOCH_MINUTE_BASE + 4);
    expect(lifetimeEpochMinute(0)).toBeLessThan(0);
  });
});
