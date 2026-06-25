import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearMockWorldVoteJobs, closeWorldVoteQueue } from "../queue/world-vote.js";
import { clearRoomVoteStateForTests, recordPlayerSpeak, tickRoomVoteClock } from "./world-vote-state.js";
import {
  evaluateVoteTrigger,
  maybeEnqueueWorldVote,
  recordCollectiveEvent,
  recordVoteCompleted,
} from "./world-vote-trigger.js";

const ROOM = "vote-test-room";
const GAME_DAY = 1440;

function advanceTicks(count: number, gameMinute = 480, nowMs = 1_000_000): void {
  for (let i = 0; i < count; i++) {
    tickRoomVoteClock(ROOM);
    evaluateVoteTrigger({
      roomId: ROOM,
      gameMinute,
      nowMs: nowMs + i,
      npcSpeakInFlight: false,
    });
  }
}

describe("world-vote-trigger", () => {
  beforeEach(async () => {
    delete process.env.VOTE_TEST_INTERVAL_MIN;
    delete process.env.VOTE_TEST_REAL_MIN_MS;
    delete process.env.VOTE_COLLECTIVE_WEIGHT_THRESHOLD;
    delete process.env.VOTE_EPOCH_YEARS;
    delete process.env.REDIS_URL;
    clearRoomVoteStateForTests();
    clearMockWorldVoteJobs();
    await closeWorldVoteQueue();
  });

  afterEach(async () => {
    clearRoomVoteStateForTests();
    clearMockWorldVoteJobs();
    await closeWorldVoteQueue();
  });

  it("blocks until grace + player speak (D-VOTE-TRIG-07)", () => {
    process.env.VOTE_TEST_INTERVAL_MIN = "1";
    advanceTicks(GAME_DAY);
    const beforeSpeak = evaluateVoteTrigger({
      roomId: ROOM,
      gameMinute: 480,
      nowMs: Date.now(),
      npcSpeakInFlight: false,
    });
    expect(beforeSpeak.shouldEnqueue).toBe(false);
    expect(beforeSpeak.reason).toBe("grace_period");

    recordPlayerSpeak(ROOM);
    advanceTicks(GAME_DAY);
    const afterSpeak = evaluateVoteTrigger({
      roomId: ROOM,
      gameMinute: 480,
      nowMs: Date.now() + 100_000,
      npcSpeakInFlight: false,
    });
    expect(afterSpeak.shouldEnqueue).toBe(true);
    expect(afterSpeak.voteKind).toBe("regular");
  });

  it("prefers epoch when both epoch and regular are due (D-VOTE-TRIG-04)", () => {
    recordPlayerSpeak(ROOM);
    process.env.VOTE_TEST_INTERVAL_MIN = "1";
    process.env.VOTE_EPOCH_YEARS = "2";
    process.env.VOTE_TEST_REAL_MIN_MS = "0";
    advanceTicks(2 * GAME_DAY);
    const result = evaluateVoteTrigger({
      roomId: ROOM,
      gameMinute: 500,
      nowMs: Date.now(),
      npcSpeakInFlight: false,
    });
    expect(result.shouldEnqueue).toBe(true);
    expect(result.voteKind).toBe("epoch");
    expect(result.debateRoundsMax).toBe(3);
  });

  it("applies regular cooldown after vote (D-VOTE-TRIG-05)", () => {
    recordPlayerSpeak(ROOM);
    process.env.VOTE_TEST_INTERVAL_MIN = "1";
    process.env.VOTE_TEST_REAL_MIN_MS = "0";
    advanceTicks(GAME_DAY + 1);
    recordVoteCompleted(ROOM, {
      gameMinute: 480,
      voteKind: "regular",
      proposerIndex: 0,
    });
    const duringCooldown = evaluateVoteTrigger({
      roomId: ROOM,
      gameMinute: 481,
      nowMs: Date.now(),
      npcSpeakInFlight: false,
    });
    expect(duringCooldown.shouldEnqueue).toBe(false);
    expect(duringCooldown.reason).toBe("cooldown");
  });

  it("skips new enqueue while speak in flight (D-VOTE-UX-06)", () => {
    recordPlayerSpeak(ROOM);
    process.env.VOTE_TEST_INTERVAL_MIN = "1";
    advanceTicks(GAME_DAY + 1);
    const result = evaluateVoteTrigger({
      roomId: ROOM,
      gameMinute: 480,
      nowMs: Date.now(),
      npcSpeakInFlight: true,
    });
    expect(result.shouldEnqueue).toBe(false);
    expect(result.reason).toBe("speak_in_flight");
  });

  it("triggers early regular when collective weight threshold met (D-VOTE-TRIG-03)", () => {
    recordPlayerSpeak(ROOM);
    process.env.VOTE_TEST_INTERVAL_MIN = "30";
    process.env.VOTE_COLLECTIVE_WEIGHT_THRESHOLD = "80";
    process.env.VOTE_TEST_REAL_MIN_MS = "0";
    advanceTicks(GAME_DAY);
    recordCollectiveEvent(ROOM, 50);
    recordCollectiveEvent(ROOM, -40);
    const result = evaluateVoteTrigger({
      roomId: ROOM,
      gameMinute: 480,
      nowMs: Date.now(),
      npcSpeakInFlight: false,
    });
    expect(result.shouldEnqueue).toBe(true);
    expect(result.voteKind).toBe("regular");
    expect(result.reason).toBe("collective_weight");
  });

  it("rotates proposer index 0→1→…→11", async () => {
    recordPlayerSpeak(ROOM);
    process.env.VOTE_TEST_INTERVAL_MIN = "1";
    process.env.VOTE_TEST_REAL_MIN_MS = "0";
    advanceTicks(GAME_DAY + 1);

    const first = evaluateVoteTrigger({
      roomId: ROOM,
      gameMinute: 480,
      nowMs: Date.now(),
      npcSpeakInFlight: false,
    });
    expect(first.proposerIndex).toBe(0);
    await maybeEnqueueWorldVote({
      roomId: ROOM,
      gameMinute: 480,
      nowMs: Date.now(),
      npcSpeakInFlight: false,
    });
    recordVoteCompleted(ROOM, {
      gameMinute: 480,
      voteKind: "regular",
      proposerIndex: 0,
    });

    advanceTicks(8 * GAME_DAY);
    const second = evaluateVoteTrigger({
      roomId: ROOM,
      gameMinute: 481,
      nowMs: Date.now() + 20_000_000,
      npcSpeakInFlight: false,
    });
    expect(second.proposerIndex).toBe(1);
  });

  it("offline catch-up enqueues at most one regular job (D-VOTE-TRIG-06)", async () => {
    recordPlayerSpeak(ROOM);
    process.env.VOTE_TEST_INTERVAL_MIN = "1";
    process.env.VOTE_TEST_REAL_MIN_MS = "0";
    process.env.VOTE_EPOCH_YEARS = "99";
    advanceTicks(GAME_DAY + 1);

    const firstId = await maybeEnqueueWorldVote({
      roomId: ROOM,
      gameMinute: 480,
      nowMs: Date.now(),
      npcSpeakInFlight: false,
    });
    expect(firstId).toBeTruthy();

    for (let i = 0; i < 50; i++) {
      tickRoomVoteClock(ROOM);
    }
    const secondId = await maybeEnqueueWorldVote({
      roomId: ROOM,
      gameMinute: 480,
      nowMs: Date.now(),
      npcSpeakInFlight: false,
    });
    expect(secondId).toBe(firstId);
  });
});
