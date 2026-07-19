/**
 * Personal timeline job queue (D-SEED-01/04, D-GEN-01/04).
 * Skeleton inserts on room create; reflect/lore polish + weekly digest async — never speak-slot LLM.
 */

import { Redis } from "ioredis";

/** Seed polish jobs — kind optional for back-compat with plan 03 enqueue. */
export type PersonalTimelinePolishJobPayload = {
  kind?: "polish";
  roomId: string;
  npcId: string;
  entryId: string;
  lifeNodeKey: string;
  age: string;
  event: string;
  skeletonBody: string;
  jobId: string;
  enqueuedAt: string;
};

export type PersonalTimelineWeeklyJobPayload = {
  kind: "weekly";
  roomId: string;
  npcId: string;
  aetherEpochMinute: number;
  dayIndex: number;
  jobId: string;
  enqueuedAt: string;
  recentBullets?: string[];
};

/** Plan 05 stubs — hammer/REL only (not full D-GEN-02). */
export type PersonalTimelineStubJobPayload = {
  kind: "event" | "multi" | "rel";
  roomId: string;
  npcId: string;
  jobId: string;
  enqueuedAt: string;
  [key: string]: unknown;
};

export type PersonalTimelineJobPayload =
  | PersonalTimelinePolishJobPayload
  | PersonalTimelineWeeklyJobPayload
  | PersonalTimelineStubJobPayload;

export const PERSONAL_TIMELINE_JOBS_KEY = "aetherlife:personal-timeline:jobs";

const mockJobs = new Map<string, PersonalTimelineJobPayload>();

function getRedisUrl(): string | undefined {
  return process.env.REDIS_URL;
}

function createRedis(url: string): Redis {
  const client = new Redis(url, { maxRetriesPerRequest: null });
  client.on("error", (err) => {
    console.error("[redis]", err.message);
  });
  return client;
}

export function personalTimelinePolishJobId(
  roomId: string,
  npcId: string,
  lifeNodeKey: string,
): string {
  return `pt-polish-${roomId}-${npcId}-${lifeNodeKey}`;
}

export function personalTimelineWeeklyJobId(
  roomId: string,
  npcId: string,
  dayIndex: number,
): string {
  return `pt-weekly-${roomId}-${npcId}-${dayIndex}`;
}

async function lpushJob(payload: PersonalTimelineJobPayload): Promise<void> {
  const url = getRedisUrl();
  if (!url) return;
  const client = createRedis(url);
  try {
    await client.lpush(PERSONAL_TIMELINE_JOBS_KEY, JSON.stringify(payload));
  } finally {
    await client.quit();
  }
}

/**
 * Enqueue a polish job (Redis LPUSH when REDIS_URL set; always recorded in mock map for tests).
 * Returns jobId, or null only if payload invalid.
 */
export async function enqueuePersonalTimelinePolishJob(input: {
  roomId: string;
  npcId: string;
  entryId: string;
  lifeNodeKey: string;
  age: string;
  event: string;
  skeletonBody: string;
}): Promise<string | null> {
  const jobId = personalTimelinePolishJobId(
    input.roomId,
    input.npcId,
    input.lifeNodeKey,
  );
  const payload: PersonalTimelinePolishJobPayload = {
    kind: "polish",
    ...input,
    jobId,
    enqueuedAt: new Date().toISOString(),
  };

  await lpushJob(payload);
  mockJobs.set(jobId, payload);
  return jobId;
}

/**
 * Weekly digest job (D-GEN-01/04) — one NPC per enqueue; stagger handled by caller.
 */
export async function enqueuePersonalTimelineWeeklyJob(input: {
  roomId: string;
  npcId: string;
  aetherEpochMinute: number;
  dayIndex: number;
  recentBullets?: string[];
}): Promise<string | null> {
  const jobId = personalTimelineWeeklyJobId(
    input.roomId,
    input.npcId,
    input.dayIndex,
  );
  const payload: PersonalTimelineWeeklyJobPayload = {
    kind: "weekly",
    roomId: input.roomId,
    npcId: input.npcId,
    aetherEpochMinute: input.aetherEpochMinute,
    dayIndex: input.dayIndex,
    jobId,
    enqueuedAt: new Date().toISOString(),
    recentBullets: input.recentBullets,
  };
  await lpushJob(payload);
  mockJobs.set(jobId, payload);
  return jobId;
}

export function getMockPersonalTimelineJob(
  jobId: string,
): PersonalTimelineJobPayload | undefined {
  return mockJobs.get(jobId);
}

/** @deprecated use getMockPersonalTimelineJob */
export function getMockPersonalTimelinePolishJob(
  jobId: string,
): PersonalTimelinePolishJobPayload | undefined {
  const job = mockJobs.get(jobId);
  if (!job || (job.kind && job.kind !== "polish")) return undefined;
  return job as PersonalTimelinePolishJobPayload;
}

export function clearMockPersonalTimelinePolishJobs(): void {
  mockJobs.clear();
}

export function clearMockPersonalTimelineJobs(): void {
  mockJobs.clear();
}
