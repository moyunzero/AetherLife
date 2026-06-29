import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addWorldVoteJob,
  clearMockWorldVoteJobs,
  clearWorldVotePending,
  closeWorldVoteQueue,
  getMockWorldVoteJob,
  getPendingWorldVoteJobId,
  worldVoteJobId,
} from "./world-vote.js";

describe("world-vote queue", () => {
  beforeEach(async () => {
    delete process.env.REDIS_URL;
    await closeWorldVoteQueue();
    clearMockWorldVoteJobs();
  });

  afterEach(async () => {
    delete process.env.REDIS_URL;
    await closeWorldVoteQueue();
    clearMockWorldVoteJobs();
  });

  it("returns deterministic jobId without colon characters", async () => {
    const id = await addWorldVoteJob({
      roomId: "room-1",
      voteKind: "regular",
      gameMinute: 480,
      debateRoundsMax: 2,
      proposerIndex: 0,
    });
    expect(id).toBe(worldVoteJobId("room-1", "regular", 480));
    expect(id).not.toContain(":");
    const job = getMockWorldVoteJob(id!);
    expect(job?.voteKind).toBe("regular");
    expect(job?.debateRoundsMax).toBe(2);
    expect(job?.proposerIndex).toBe(0);
  });

  it("dedupes pending jobs per room when kind and minute unchanged", async () => {
    const first = await addWorldVoteJob({
      roomId: "room-1",
      voteKind: "regular",
      gameMinute: 480,
      debateRoundsMax: 2,
      proposerIndex: 1,
    });
    const second = await addWorldVoteJob({
      roomId: "room-1",
      voteKind: "regular",
      gameMinute: 480,
      debateRoundsMax: 2,
      proposerIndex: 1,
    });
    expect(second).toBe(first);
  });

  it("replaces stale pending when voteKind or gameMinute differs", async () => {
    const first = await addWorldVoteJob({
      roomId: "room-1",
      voteKind: "regular",
      gameMinute: 480,
      debateRoundsMax: 2,
      proposerIndex: 0,
    });
    const second = await addWorldVoteJob({
      roomId: "room-1",
      voteKind: "epoch",
      gameMinute: 481,
      debateRoundsMax: 3,
      proposerIndex: 1,
    });
    expect(second).not.toBe(first);
    expect(second).toBe(worldVoteJobId("room-1", "epoch", 481));
  });

  it("allows parallel pending jobs for different rooms", async () => {
    const roomA = await addWorldVoteJob({
      roomId: "room-a",
      voteKind: "regular",
      gameMinute: 480,
      debateRoundsMax: 2,
      proposerIndex: 0,
    });
    const roomB = await addWorldVoteJob({
      roomId: "room-b",
      voteKind: "regular",
      gameMinute: 480,
      debateRoundsMax: 2,
      proposerIndex: 0,
    });
    expect(roomA).not.toBe(roomB);
  });

  it("clearWorldVotePending releases room slot", async () => {
    const id = await addWorldVoteJob({
      roomId: "room-1",
      voteKind: "regular",
      gameMinute: 480,
      debateRoundsMax: 2,
      proposerIndex: 0,
    });
    clearWorldVotePending("room-1");
    const next = await addWorldVoteJob({
      roomId: "room-1",
      voteKind: "regular",
      gameMinute: 481,
      debateRoundsMax: 2,
      proposerIndex: 1,
    });
    expect(next).not.toBe(id);
  });

  it("getPendingWorldVoteJobId tracks in-flight job", async () => {
    expect(getPendingWorldVoteJobId("room-1")).toBeUndefined();
    const id = await addWorldVoteJob({
      roomId: "room-1",
      voteKind: "regular",
      gameMinute: 480,
      debateRoundsMax: 2,
      proposerIndex: 0,
    });
    expect(getPendingWorldVoteJobId("room-1")).toBe(id);
    clearWorldVotePending("room-1", id ?? undefined);
    expect(getPendingWorldVoteJobId("room-1")).toBeUndefined();
  });

  it("addWorldVoteContinuationJob sets resumeJobId and instant=false", async () => {
    const { addWorldVoteContinuationJob } = await import("./world-vote.js");
    const id = await addWorldVoteContinuationJob({
      roomId: "room-1",
      resumeJobId: "vote-room-1-regular-480",
      debateRound: 2,
      gameMinute: 480,
      voteKind: "regular",
      proposerIndex: 0,
      debateRoundsMax: 2,
    });
    expect(id).toBe("vote-room-1-regular-480-r2");
    const job = getMockWorldVoteJob(id!);
    expect(job?.resumeJobId).toBe("vote-room-1-regular-480");
    expect(job?.instant).toBe(false);
  });
});
