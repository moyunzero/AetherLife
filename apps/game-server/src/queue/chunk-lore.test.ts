import { afterEach, describe, expect, it } from "vitest";
import { addChunkLoreJob, clearMockLoreJobs, getMockLoreJob } from "./chunk-lore.js";
import { loreJobId as sharedLoreJobId, loreJobId } from "@aetherlife/shared";

describe("chunk-lore queue", () => {
  afterEach(() => {
    delete process.env.REDIS_URL;
    clearMockLoreJobs();
  });

  it("uses deterministic jobId lore-world-cx-cy", async () => {
    const id = await addChunkLoreJob({
      worldId: "world-a",
      mapRoomId: "room-1",
      cx: 1,
      cy: 2,
      worldSeed: "42",
      dominantBiome: "meadow",
      walkableRatio: 0.8,
      modelTier: "T1",
      triggerPlayerId: "player-1",
    });
    expect(id).toBe(sharedLoreJobId("world-a", 1, 2));
    const job = getMockLoreJob(id);
    expect(job?.dominantBiome).toBe("meadow");
  });

  it("second add with same coords overwrites mock entry without duplicate id", async () => {
    const base = {
      worldId: "w",
      mapRoomId: "r",
      cx: 3,
      cy: 4,
      worldSeed: "42",
      dominantBiome: "scrub",
      walkableRatio: 0.5,
      modelTier: "T0" as const,
      triggerPlayerId: "p1",
    };
    await addChunkLoreJob(base);
    await addChunkLoreJob({ ...base, triggerPlayerId: "p2" });
    expect(getMockLoreJob(loreJobId("w", 3, 4))?.triggerPlayerId).toBe("p2");
  });
});
