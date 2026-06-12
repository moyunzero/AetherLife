import { describe, expect, it, beforeEach } from "vitest";
import {
  clearWorkerStateCache,
  getCachedWorkerState,
  invalidateWorkerStateForPlayer,
  setCachedWorkerState,
  workerStateCacheKey,
} from "./workerStateCache.js";
import { createDefaultRoom } from "@aetherlife/shared";

describe("workerStateCache", () => {
  beforeEach(() => {
    clearWorkerStateCache();
  });

  it("invalidateWorkerStateForPlayer drops keys for that player only", () => {
    const state = createDefaultRoom();
    const keyA = workerStateCacheKey("default", "player-a", false);
    const keyB = workerStateCacheKey("default", "player-b", false);
    const payload = { state, nearbyLore: [] };
    setCachedWorkerState(keyA, payload, false);
    setCachedWorkerState(keyB, payload, false);

    invalidateWorkerStateForPlayer("default", "player-a");

    expect(getCachedWorkerState(keyA)).toBeNull();
    expect(getCachedWorkerState(keyB)).toEqual(payload);
  });
});
