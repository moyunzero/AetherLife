import { describe, expect, it, vi, beforeEach } from "vitest";
import { clearChunkLoreCache, getChunkLoreCached } from "./lore-chunk-cache.js";
import * as loreRepo from "./lore-repository.js";

describe("lore-chunk-cache", () => {
  beforeEach(() => {
    clearChunkLoreCache();
    vi.restoreAllMocks();
  });

  it("returns cached row on second call without hitting repository", async () => {
    const row = { lore: { nameZh: "测试", flavorOneLine: "line" } as never, modelTier: "t0" };
    const spy = vi.spyOn(loreRepo, "getChunkLore").mockResolvedValue(row);

    const first = await getChunkLoreCached("world-1", 1, 2);
    const second = await getChunkLoreCached("world-1", 1, 2);

    expect(first).toEqual(row);
    expect(second).toEqual(row);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
