import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Room } from "colyseus";
import {
  clearJobRegistry,
  getJobEntry,
  jobRegistrySizeForTest,
  MAX_JOBS,
  MIN_JOB_AGE_MS,
  registerJob,
  registerJobForTest,
} from "./job-registry.js";

const fakeRoom = {} as Room;

describe("job-registry eviction", () => {
  beforeEach(() => {
    clearJobRegistry();
    vi.useFakeTimers();
  });

  afterEach(() => {
    clearJobRegistry();
    vi.useRealTimers();
  });

  it("evicts stale jobs before registering when at capacity", () => {
    const now = Date.now();
    for (let i = 0; i < MAX_JOBS; i++) {
      registerJobForTest(`old-${i}`, fakeRoom, "room-1", now - MIN_JOB_AGE_MS - 1);
    }
    expect(jobRegistrySizeForTest()).toBe(MAX_JOBS);

    registerJob("fresh-job", fakeRoom, "room-1");
    expect(jobRegistrySizeForTest()).toBe(MAX_JOBS);
    expect(getJobEntry("fresh-job")).toBeDefined();
    expect(getJobEntry("old-0")).toBeUndefined();
  });

  it("does not evict recent jobs until one is stale", () => {
    const now = Date.now();
    for (let i = 0; i < MAX_JOBS; i++) {
      registerJobForTest(`recent-${i}`, fakeRoom, "room-1", now);
    }

    vi.advanceTimersByTime(MIN_JOB_AGE_MS + 1);
    registerJob("new-job", fakeRoom, "room-1");
    expect(jobRegistrySizeForTest()).toBe(MAX_JOBS);
  });
});
