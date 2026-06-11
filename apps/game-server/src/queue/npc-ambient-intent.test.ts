import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addNpcAmbientIntentJob,
  ambientIntentJobId,
  clearMockAmbientIntentJobs,
  closeNpcAmbientIntentQueue,
  getMockAmbientIntentJob,
} from "./npc-ambient-intent.js";

describe("npc-ambient-intent queue", () => {
  beforeEach(async () => {
    delete process.env.REDIS_URL;
    await closeNpcAmbientIntentQueue();
    clearMockAmbientIntentJobs();
  });

  afterEach(async () => {
    delete process.env.REDIS_URL;
    await closeNpcAmbientIntentQueue();
    clearMockAmbientIntentJobs();
  });

  it("returns deterministic jobId", async () => {
    const id = await addNpcAmbientIntentJob({
      roomId: "room-1",
      npcId: "npc-1",
      gameMinute: 480,
      segment: {
        zoneId: "home-yard",
        activityKey: "patrol",
        mobility: "wander",
      },
      trigger: "segment_change",
    });
    expect(id).toBe(ambientIntentJobId("room-1", "npc-1", "segment_change", 480));
    const job = getMockAmbientIntentJob(id!);
    expect(job?.segment.zoneId).toBe("home-yard");
  });

  it("dedupes pending jobs per roomId+npcId when trigger and minute unchanged", async () => {
    const first = await addNpcAmbientIntentJob({
      roomId: "room-1",
      npcId: "npc-2",
      gameMinute: 480,
      segment: { zoneId: "home-yard", activityKey: "idle", mobility: "stationary" },
      trigger: "segment_change",
    });
    const second = await addNpcAmbientIntentJob({
      roomId: "room-1",
      npcId: "npc-2",
      gameMinute: 480,
      segment: { zoneId: "home-yard", activityKey: "idle", mobility: "stationary" },
      trigger: "segment_change",
    });
    expect(second).toBe(first);
  });

  it("replaces stale pending when gameMinute or trigger differs", async () => {
    const first = await addNpcAmbientIntentJob({
      roomId: "room-1",
      npcId: "npc-2",
      gameMinute: 480,
      segment: { zoneId: "home-yard", activityKey: "idle", mobility: "stationary" },
      trigger: "segment_change",
    });
    const second = await addNpcAmbientIntentJob({
      roomId: "room-1",
      npcId: "npc-2",
      gameMinute: 481,
      segment: { zoneId: "home-yard", activityKey: "idle", mobility: "stationary" },
      trigger: "speak_end",
    });
    expect(second).not.toBe(first);
    expect(second).toBe(ambientIntentJobId("room-1", "npc-2", "speak_end", 481));
  });

  it("allows parallel pending jobs for same npcId in different rooms", async () => {
    const roomA = await addNpcAmbientIntentJob({
      roomId: "room-a",
      npcId: "npc-1",
      gameMinute: 480,
      segment: { zoneId: "home-yard", activityKey: "patrol", mobility: "wander" },
      trigger: "segment_change",
    });
    const roomB = await addNpcAmbientIntentJob({
      roomId: "room-b",
      npcId: "npc-1",
      gameMinute: 480,
      segment: { zoneId: "home-yard", activityKey: "patrol", mobility: "wander" },
      trigger: "segment_change",
    });
    expect(roomA).not.toBe(roomB);
  });
});
