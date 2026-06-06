import { afterEach, describe, expect, it } from "vitest";
import {
  clearChunkLoreMemory,
  deleteChunkLore,
  getChunkLore,
  upsertChunkLore,
} from "./lore-repository.js";

const sampleLore = {
  nameZh: "测试谷",
  flavorOneLine: "风从草甸吹过",
  storyHook: "据说夜里能听见低语。",
  proceduralBiome: "meadow" as const,
  moodTag: "宁静",
  npcRumor: "旅人常在此歇脚。",
  hiddenQuestSeed: "seed-test",
};

describe("lore-repository", () => {
  afterEach(() => {
    delete process.env.DATABASE_URL;
    clearChunkLoreMemory();
  });

  it("upsert then get returns same lore", async () => {
    await upsertChunkLore("world-1", 2, 3, sampleLore, "T1");
    const row = await getChunkLore("world-1", 2, 3);
    expect(row?.lore.nameZh).toBe("测试谷");
    expect(row?.modelTier).toBe("T1");
  });

  it("delete removes row", async () => {
    await upsertChunkLore("world-1", 1, 1, sampleLore, "T0");
    await deleteChunkLore("world-1", 1, 1);
    expect(await getChunkLore("world-1", 1, 1)).toBeNull();
  });

  it("rejects invalid lore before persist", async () => {
    await expect(
      upsertChunkLore("world-1", 0, 1, { nameZh: "" }, "T0"),
    ).rejects.toThrow();
  });
});
