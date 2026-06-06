import { describe, expect, it } from "vitest";
import {
  buildLoreSyncEntry,
  chunkCrossed,
  resolveModelTier,
  shouldEnqueueWhenNoRow,
  shouldSkipLoreGeneration,
} from "./lore-orchestrator.js";

describe("lore-orchestrator pure helpers", () => {
  it("shouldSkipLoreGeneration only for (0,0)", () => {
    expect(shouldSkipLoreGeneration(0, 0)).toBe(true);
    expect(shouldSkipLoreGeneration(1, 0)).toBe(false);
  });

  it("chunkCrossed detects chunk index change", () => {
    expect(chunkCrossed(7, 0, 8, 0)).toBe(true);
    expect(chunkCrossed(8, 0, 8, 1)).toBe(false);
  });

  it("resolveModelTier T1 then T0", () => {
    expect(resolveModelTier(0)).toBe("T1");
    expect(resolveModelTier(1)).toBe("T0");
  });

  it("shouldEnqueueWhenNoRow", () => {
    expect(shouldEnqueueWhenNoRow(null)).toBe(true);
    expect(shouldEnqueueWhenNoRow({})).toBe(false);
  });

  it("buildLoreSyncEntry strips secrets via toChunkLorePublic", () => {
    const entry = buildLoreSyncEntry({
      cx: 1,
      cy: 0,
      status: "ready",
      lore: {
        nameZh: "测试",
        flavorOneLine: "描述",
        storyHook: "故事",
        proceduralBiome: "meadow",
        moodTag: "宁静",
        npcRumor: "secret rumor",
        hiddenQuestSeed: "secret seed",
      },
      isFirstDiscover: true,
    });
    expect(entry.lore).not.toHaveProperty("npcRumor");
    expect(entry.isFirstDiscover).toBe(true);
  });
});
