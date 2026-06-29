import { afterEach, describe, expect, it } from "vitest";
import {
  capDebateRoundsMax,
  debateRoundGameDays,
  debateRoundsCap,
  nextRoundAtGameMinute,
  resolveInstantDebate,
} from "./world-vote-pacing.js";

describe("world-vote-pacing", () => {
  afterEach(() => {
    delete process.env.VOTE_DEBATE_ROUNDS_MAX;
    delete process.env.VOTE_INSTANT_DEBATE;
    delete process.env.VOTE_DEBATE_ROUND_GAME_DAYS;
  });

  it("caps debate rounds at env max (default 5)", () => {
    expect(debateRoundsCap()).toBe(5);
    expect(capDebateRoundsMax(99)).toBe(5);
    expect(capDebateRoundsMax(3)).toBe(3);
    expect(capDebateRoundsMax(0)).toBe(1);
  });

  it("defaults instant debate on for UAT/dev", () => {
    expect(resolveInstantDebate()).toBe(true);
    process.env.VOTE_INSTANT_DEBATE = "0";
    expect(resolveInstantDebate()).toBe(false);
  });

  it("schedules next round one game-day ahead by default", () => {
    expect(debateRoundGameDays()).toBe(1);
    expect(nextRoundAtGameMinute(480)).toBe(480 + 1440);
  });
});
