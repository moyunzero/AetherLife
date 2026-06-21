import { describe, expect, it } from "vitest";
import { discoveredLoreRows, loreDiscoverToastsFromSync } from "./useChunkLore.js";
import type { ChunkLoreEntry } from "./useChunkLore.js";

describe("discoveredLoreRows", () => {
  it("returns ready chunks sorted by nameZh without coordinates", () => {
    const loreByChunk = new Map<string, ChunkLoreEntry>([
      [
        "1,0",
        {
          status: "ready",
          lore: {
            nameZh: "乙地",
            flavorOneLine: "f",
            storyHook: "hook b",
            proceduralBiome: "meadow",
          },
        },
      ],
      [
        "0,0",
        {
          status: "ready",
          lore: {
            nameZh: "甲地",
            flavorOneLine: "f",
            storyHook: "hook a",
            proceduralBiome: "meadow",
          },
        },
      ],
      ["2,0", { status: "pending" }],
    ]);
    expect(discoveredLoreRows(loreByChunk)).toEqual([
      { nameZh: "甲地", storyHook: "hook a" },
      { nameZh: "乙地", storyHook: "hook b" },
    ]);
  });
});

describe("loreDiscoverToastsFromSync", () => {
  it("queues toast on ready after pending isFirstDiscover (split loreSync messages)", () => {
    const pending = new Set<string>();
    loreDiscoverToastsFromSync(
      [{ cx: 9, cy: 13, status: "pending", isFirstDiscover: true }],
      pending,
    );
    const toasts = loreDiscoverToastsFromSync(
      [
        {
          cx: 9,
          cy: 13,
          status: "ready",
          lore: {
            nameZh: "测试草甸",
            flavorOneLine: "一句 flavor",
            storyHook: "据说这里有故事。",
            proceduralBiome: "meadow",
          },
        },
      ],
      pending,
    );
    expect(toasts).toEqual([{ cx: 9, cy: 13, storyHook: "据说这里有故事。" }]);
    expect(pending.size).toBe(0);
  });

  it("does not toast on ready without prior isFirstDiscover pending", () => {
    const pending = new Set<string>();
    const toasts = loreDiscoverToastsFromSync(
      [
        {
          cx: 1,
          cy: 0,
          status: "ready",
          lore: {
            nameZh: "缓存地",
            flavorOneLine: "f",
            storyHook: "hook",
            proceduralBiome: "meadow",
          },
        },
      ],
      pending,
    );
    expect(toasts).toEqual([]);
  });
});
