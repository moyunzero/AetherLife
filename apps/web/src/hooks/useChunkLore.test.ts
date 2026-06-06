import { describe, expect, it } from "vitest";
import { loreDiscoverToastsFromSync } from "./useChunkLore.js";

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
