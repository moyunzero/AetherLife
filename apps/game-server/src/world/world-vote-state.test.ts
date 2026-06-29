import { afterEach, describe, expect, it } from "vitest";
import {
  applyDeliberationCheckpoint,
  clearRoomVoteStateForTests,
  getActiveDeliberation,
  isDeliberationContinuationDue,
  tickRoomVoteClock,
} from "./world-vote-state.js";

const ROOM = "state-test-room";

describe("world-vote-state paced deliberation", () => {
  afterEach(() => {
    delete process.env.VOTE_DEBATE_ROUND_GAME_DAYS;
    clearRoomVoteStateForTests();
  });

  it("applyDeliberationCheckpoint schedules next round one game-day ahead", () => {
    tickRoomVoteClock(ROOM);
    const ck = applyDeliberationCheckpoint(ROOM, {
      jobId: "vote-room-regular-480",
      voteKind: "regular",
      proposerIndex: 0,
      proposalTitle: "测试提案",
      proposalBody: "提案正文",
      currentRound: 1,
      debateRoundsMax: 2,
      phase: "debate",
      transcript: [{ npcId: "npc-1", text: "宣读", round: 0 }],
    });
    expect(ck.nextRoundAtGameMinute).toBe(1441);
    expect(getActiveDeliberation(ROOM)?.currentRound).toBe(1);
    expect(isDeliberationContinuationDue(ROOM)).toBe(false);
    tickRoomVoteClock(ROOM);
    for (let i = 0; i < 1440; i++) {
      tickRoomVoteClock(ROOM);
    }
    expect(isDeliberationContinuationDue(ROOM)).toBe(true);
  });
});
