import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockRemove = vi.fn().mockResolvedValue(undefined);
const mockGetJob = vi.fn().mockResolvedValue({ remove: mockRemove });
const mockAdd = vi.fn().mockResolvedValue(undefined);
const mockLpush = vi.fn().mockRejectedValue(new Error("bridge down"));
const mockQuit = vi.fn().mockResolvedValue(undefined);

vi.mock("bullmq", () => ({
  Queue: class MockQueue {
    add = mockAdd;
    getJob = mockGetJob;
    close = vi.fn().mockResolvedValue(undefined);
  },
}));

vi.mock("ioredis", () => ({
  Redis: class MockRedis {
    on = vi.fn();
    lpush = mockLpush;
    quit = mockQuit;
  },
}));

describe("addNpcTurnJob bridge rollback", () => {
  beforeEach(async () => {
    mockAdd.mockClear();
    mockGetJob.mockClear();
    mockRemove.mockClear();
    mockLpush.mockRejectedValue(new Error("bridge down"));
    process.env.REDIS_URL = "redis://127.0.0.1:6379";
    const mod = await import("./npc-turn.js");
    await mod.closeNpcTurnQueue();
    mod.clearMockJobs();
  });

  afterEach(async () => {
    delete process.env.REDIS_URL;
    const mod = await import("./npc-turn.js");
    await mod.closeNpcTurnQueue();
    mod.clearMockJobs();
  });

  it("removes BullMQ job when Redis bridge push fails", async () => {
    const { addNpcTurnJob } = await import("./npc-turn.js");
    await expect(
      addNpcTurnJob({
        roomId: "room-1",
        playerMessage: "hi",
        npcId: "npc-1",
        playerId: "player-1",
        jobId: "job-rollback-1",
      }),
    ).rejects.toThrow("bridge down");

    expect(mockAdd).toHaveBeenCalledOnce();
    expect(mockGetJob).toHaveBeenCalledWith("job-rollback-1");
    expect(mockRemove).toHaveBeenCalledOnce();
  });
});
