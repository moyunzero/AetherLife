import { describe, expect, it, beforeEach } from "vitest";
import {
  clearMemoryContextCache,
  getCachedMemoryContext,
  invalidateMemoryContextForPlayer,
  memoryContextCacheKey,
  setCachedMemoryContext,
} from "./memoryContextCache.js";
import type { MemoryContext } from "./service.js";

function stubContext(label: string): MemoryContext {
  return {
    memoryCount: 1,
    retrieved: [{ text: label, importance: 5, similarity: 0.9 } as never],
    latestBulkSummary: null,
    latestReflection: null,
    timingMs: 0,
    collective: {
      band: "neutral",
      effectiveScore: 0,
      collectiveWindowMean: 0,
      playerReputation: 0,
      allowedTools: ["move", "speak"],
      recentSummaries: [],
    },
  };
}

describe("memoryContextCache", () => {
  beforeEach(() => {
    clearMemoryContextCache();
  });

  it("returns cached context before TTL expires", () => {
    const key = memoryContextCacheKey("room", "p-a", "npc-1", "hello", true);
    const ctx = stubContext("one");
    setCachedMemoryContext(key, ctx);
    expect(getCachedMemoryContext(key)).toBe(ctx);
  });

  it("invalidateMemoryContextForPlayer drops npc-scoped keys only for that npc", () => {
    const keyA = memoryContextCacheKey("room", "p-a", "npc-1", "msg", true);
    const keyB = memoryContextCacheKey("room", "p-a", "npc-2", "msg", true);
    const keyOther = memoryContextCacheKey("room", "p-b", "npc-1", "msg", true);
    setCachedMemoryContext(keyA, stubContext("a"));
    setCachedMemoryContext(keyB, stubContext("b"));
    setCachedMemoryContext(keyOther, stubContext("other"));

    invalidateMemoryContextForPlayer("room", "p-a", "npc-1");

    expect(getCachedMemoryContext(keyA)).toBeNull();
    expect(getCachedMemoryContext(keyB)).not.toBeNull();
    expect(getCachedMemoryContext(keyOther)).not.toBeNull();
  });

  it("invalidateMemoryContextForPlayer without npcId clears all player keys", () => {
    const keyA = memoryContextCacheKey("room", "p-a", "npc-1", "msg", true);
    const keyB = memoryContextCacheKey("room", "p-a", "npc-2", "msg2", false);
    setCachedMemoryContext(keyA, stubContext("a"));
    setCachedMemoryContext(keyB, stubContext("b"));

    invalidateMemoryContextForPlayer("room", "p-a");

    expect(getCachedMemoryContext(keyA)).toBeNull();
    expect(getCachedMemoryContext(keyB)).toBeNull();
  });
});
