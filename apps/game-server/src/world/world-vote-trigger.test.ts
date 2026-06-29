import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearMockWorldVoteJobs, closeWorldVoteQueue, getMockWorldVoteJob } from "../queue/world-vote.js";
import * as npcTurn from "../queue/npc-turn.js";
import { startNpcChatTurn } from "../colyseus/npc-chat.js";
import {
  applyDeliberationCheckpoint,
  clearRoomVoteStateForTests,
  getRoomVoteState,
  recordPlayerSpeak,
  tickRoomVoteClock,
} from "./world-vote-state.js";
import {
  evaluateVoteTrigger,
  forceEnqueueWorldVote,
  maybeEnqueueDeliberationContinuation,
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

  it("forceEnqueueWorldVote blocks when a vote job is already pending", async () => {
    const first = await forceEnqueueWorldVote({
      roomId: ROOM,
      gameMinute: 480,
      voteKind: "regular",
      debateRoundsMax: 1,
    });
    expect(first).toBeTruthy();

    const second = await forceEnqueueWorldVote({
      roomId: ROOM,
      gameMinute: 482,
      voteKind: "regular",
      debateRoundsMax: 1,
    });
    expect(second).toBeNull();
  });

  it("blocks new vote trigger while paced deliberation checkpoint active", () => {
    recordPlayerSpeak(ROOM);
    process.env.VOTE_TEST_INTERVAL_MIN = "1";
    for (let i = 0; i < GAME_DAY + 1; i++) {
      tickRoomVoteClock(ROOM);
    }
    applyDeliberationCheckpoint(ROOM, {
      jobId: "vote-room-regular-480",
      voteKind: "regular",
      proposerIndex: 0,
      proposalTitle: "测试",
      proposalBody: "正文",
      currentRound: 1,
      debateRoundsMax: 2,
      phase: "debate",
      transcript: [],
    });
    const result = evaluateVoteTrigger({
      roomId: ROOM,
      gameMinute: 480,
      nowMs: Date.now(),
      npcSpeakInFlight: false,
    });
    expect(result.shouldEnqueue).toBe(false);
    expect(result.reason).toBe("deliberation_in_progress");
  });

  it("maybeEnqueueDeliberationContinuation enqueues slice when game-day due", async () => {
    tickRoomVoteClock(ROOM);
    applyDeliberationCheckpoint(ROOM, {
      jobId: "vote-room-regular-480",
      voteKind: "regular",
      proposerIndex: 0,
      proposalTitle: "测试",
      proposalBody: "正文",
      currentRound: 1,
      debateRoundsMax: 2,
      phase: "debate",
      transcript: [],
    });
    for (let i = 0; i < 1440; i++) {
      tickRoomVoteClock(ROOM);
    }
    const jobId = await maybeEnqueueDeliberationContinuation({
      roomId: ROOM,
      gameMinute: 500,
    });
    expect(jobId).toBe("vote-room-regular-480-r2");
    const job = getMockWorldVoteJob(jobId!);
    expect(job?.instant).toBe(false);
    expect(job?.resumeJobId).toBe("vote-room-regular-480");
  });

  it("GameRoom speak contract: recordPlayerSpeak only after successful enqueue", async () => {
    const roomId = "speak-order-room";
    const enqueueSpy = vi.spyOn(npcTurn, "addNpcTurnJob");

    async function speakAfterEnqueue() {
      await startNpcChatTurn(roomId, "你好", "npc-1", "player-alpha01", "job-speak-order");
      recordPlayerSpeak(roomId);
    }

    enqueueSpy.mockRejectedValueOnce(new Error("redis unavailable"));
    await expect(speakAfterEnqueue()).rejects.toThrow("redis unavailable");
    expect(getRoomVoteState(roomId).hasPlayerSpeak).toBe(false);

    enqueueSpy.mockResolvedValueOnce("job-speak-order");
    await speakAfterEnqueue();
    expect(getRoomVoteState(roomId).hasPlayerSpeak).toBe(true);

    enqueueSpy.mockRestore();
  });
});
