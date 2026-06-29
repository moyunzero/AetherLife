import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  councilDeliberationSyncPayloadSchema,
  COLYSEUS_SERVER_MESSAGES,
} from "@aetherlife/shared";
import { clearMockWorldVoteJobs, closeWorldVoteQueue } from "../queue/world-vote.js";
import {
  clearRoomVoteStateForTests,
  recordPlayerSpeak,
  tickRoomVoteClock,
} from "./world-vote-state.js";
import {
  evaluateVoteTrigger,
  maybeEnqueueWorldVote,
  recordVoteCompleted,
} from "./world-vote-trigger.js";
import { broadcastCouncilDeliberationSync } from "./council-deliberation-broadcast.js";

const ROOM = "internal-vote-complete-room";
const GAME_DAY = 1440;

describe("internal-world-vote routes", () => {
  beforeEach(async () => {
    delete process.env.VOTE_TEST_INTERVAL_MIN;
    delete process.env.VOTE_TEST_REAL_MIN_MS;
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

  it("recordVoteCompleted clears pending and allows re-enqueue after cooldown", async () => {
    recordPlayerSpeak(ROOM);
    process.env.VOTE_TEST_INTERVAL_MIN = "1";
    process.env.VOTE_TEST_REAL_MIN_MS = "0";

    for (let i = 0; i < GAME_DAY + 1; i++) {
      tickRoomVoteClock(ROOM);
    }

    const jobId = await maybeEnqueueWorldVote({
      roomId: ROOM,
      gameMinute: 480,
      nowMs: Date.now(),
      npcSpeakInFlight: false,
    });
    expect(jobId).toBeTruthy();

    recordVoteCompleted(ROOM, {
      gameMinute: 480,
      voteKind: "regular",
      proposerIndex: 0,
      jobId: jobId ?? undefined,
    });

    const duringCooldown = evaluateVoteTrigger({
      roomId: ROOM,
      gameMinute: 481,
      nowMs: Date.now(),
      npcSpeakInFlight: false,
    });
    expect(duringCooldown.shouldEnqueue).toBe(false);
    expect(duringCooldown.reason).toBe("cooldown");

    for (let i = 0; i < 8 * GAME_DAY; i++) {
      tickRoomVoteClock(ROOM);
    }

    const afterCooldown = evaluateVoteTrigger({
      roomId: ROOM,
      gameMinute: 500,
      nowMs: Date.now() + 25_000_000,
      npcSpeakInFlight: false,
    });
    expect(afterCooldown.shouldEnqueue).toBe(true);
  });

  it("councilDeliberationSync payload schema accepts feed rows", () => {
    const payload = councilDeliberationSyncPayloadSchema.parse({
      active: true,
      voteKind: "regular",
      phase: "debate",
      round: 1,
      roundTotal: 2,
      proposalTitle: "测试提案",
      feedDelta: [
        {
          kind: "quote",
          npcId: "npc-7",
          displayName: "纳兰温言",
          text: "或许能找到平衡点。",
        },
      ],
    });
    expect(payload.phase).toBe("debate");
  });

  it("broadcastCouncilDeliberationSync is no-op without colyseus room", () => {
    expect(() =>
      broadcastCouncilDeliberationSync("nonexistent-room", {
        active: false,
        voteKind: "regular",
        phase: "sealed",
        round: 0,
        roundTotal: 2,
        clearFeed: true,
      }),
    ).not.toThrow();
  });

  it("COLYSEUS_SERVER_MESSAGES includes councilDeliberationSync", () => {
    expect(COLYSEUS_SERVER_MESSAGES.councilDeliberationSync).toBe("councilDeliberationSync");
  });
});
