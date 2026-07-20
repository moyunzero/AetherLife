import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  clearMockPersonalTimelineJobs,
  clearPersonalTimelineJobClaimsForTest,
  enqueuePersonalTimelineMultiJob,
  enqueuePersonalTimelinePolishJob,
  enqueuePersonalTimelineRelJob,
  getMockPersonalTimelineJob,
} from "./personal-timeline.js";

describe("personal-timeline job claims (CR follow-up)", () => {
  beforeEach(() => {
    delete process.env.REDIS_URL;
    clearMockPersonalTimelineJobs();
    clearPersonalTimelineJobClaimsForTest();
  });

  afterEach(() => {
    delete process.env.REDIS_URL;
  });

  it("polish claim blocks re-enqueue for same lifeNodeKey", async () => {
    const input = {
      roomId: "room-claim",
      npcId: "npc-1",
      entryId: "entry-1",
      lifeNodeKey: "life-node:npc-1:0",
      age: "16岁",
      event: "入门",
      skeletonBody: "骨架",
    };
    const first = await enqueuePersonalTimelinePolishJob(input);
    expect(first).toBeTruthy();
    expect(getMockPersonalTimelineJob(first!)?.kind).toBe("polish");

    const again = await enqueuePersonalTimelinePolishJob(input);
    expect(again).toBeNull();
  });

  it("multi claim blocks re-enqueue for same seat+anchor", async () => {
    const input = {
      roomId: "room-claim",
      npcId: "npc-3",
      eventAnchorId: "wh-1",
      factualSummary: "庭议通过。",
      aetherEpochMinute: 10_000,
      staggerOffsetGameMinutes: 60,
      hammerEpochMinute: 10_000,
    };
    const first = await enqueuePersonalTimelineMultiJob(input);
    expect(first).toBeTruthy();
    const again = await enqueuePersonalTimelineMultiJob(input);
    expect(again).toBeNull();
  });

  it("rel claim blocks re-enqueue for same seat+anchor", async () => {
    const input = {
      roomId: "room-claim",
      npcId: "npc-2",
      counterpartNpcId: "npc-9",
      eventAnchorId: "rel-1",
      affectionDelta: 8,
      aetherEpochMinute: 5000,
    };
    const first = await enqueuePersonalTimelineRelJob(input);
    expect(first).toBeTruthy();
    const again = await enqueuePersonalTimelineRelJob(input);
    expect(again).toBeNull();
  });

  it("releases claim so a failed enqueue jobId can be retried", async () => {
    const {
      claimPersonalTimelineJobId,
      releasePersonalTimelineJobId,
    } = await import("./personal-timeline.js");
    const jobId = "pt-release-retry-1";
    expect(await claimPersonalTimelineJobId(jobId)).toBe(true);
    expect(await claimPersonalTimelineJobId(jobId)).toBe(false);
    await releasePersonalTimelineJobId(jobId);
    expect(await claimPersonalTimelineJobId(jobId)).toBe(true);
  });
});
