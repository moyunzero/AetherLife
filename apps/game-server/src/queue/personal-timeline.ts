/**
 * Personal timeline job queue (D-SEED-01/04, D-GEN-01/04, BIO-06, REL-07).
 * Skeleton inserts on room create; reflect/lore polish + weekly + multi/rel async — never speak-slot LLM.
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

/** BIO-06 multi-perspective after world_history hammer. */
export type PersonalTimelineMultiJobPayload = {
  kind: "multi";
  roomId: string;
  npcId: string;
  eventAnchorId: string;
  factualSummary: string;
  aetherEpochMinute: number;
  staggerOffsetGameMinutes: number;
  hammerEpochMinute?: number;
  tag?: "council";
  jobId: string;
  enqueuedAt: string;
};

/** REL-07 bilateral relationship biography. */
export type PersonalTimelineRelJobPayload = {
  kind: "rel";
  roomId: string;
  npcId: string;
  counterpartNpcId: string;
  eventAnchorId: string;
  affectionDelta: number;
  historyAppend?: string;
  aetherEpochMinute: number;
  tag?: "relationship";
  jobId: string;
  enqueuedAt: string;
};

/** Non-vote dyad event → apply-deltas + forced bilateral REL diaries. */
export type PersonalTimelineEventJobPayload = {
  kind: "event";
  roomId: string;
  npcId: string;
  counterpartNpcId: string;
  eventAnchorId: string;
  factualSummary: string;
  affectionDelta: number;
  aetherEpochMinute: number;
  historyAppend?: string;
  jobId: string;
  enqueuedAt: string;
};

export type PersonalTimelineJobPayload =
  | PersonalTimelinePolishJobPayload
  | PersonalTimelineWeeklyJobPayload
  | PersonalTimelineMultiJobPayload
  | PersonalTimelineRelJobPayload
  | PersonalTimelineEventJobPayload;

export const PERSONAL_TIMELINE_JOBS_KEY = "aetherlife:personal-timeline:jobs";

/** Durable enqueue claim — survives game-server restart (WR-02). */
export const PERSONAL_TIMELINE_JOB_CLAIM_PREFIX =
  "aetherlife:personal-timeline:job-claimed:";

/** D-MULTI-04: 30 game minutes between seats → ~5.5h for 12 seats. */
export const MULTI_STAGGER_GAME_MINUTES = 30;

/** Claim TTL: ~16 Aether days in wall-clock is overkill; 14d wall is enough for restart dedupe. */
const JOB_CLAIM_TTL_SECONDS = 60 * 60 * 24 * 14;

const mockJobs = new Map<string, PersonalTimelineJobPayload>();
/** Process-local claim mirror when Redis is unavailable (tests / no REDIS_URL). */
const localJobClaims = new Set<string>();

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

/**
 * SET NX claim before LPUSH so restart/multi-instance cannot re-enqueue the same jobId.
 * Without Redis: process-local Set (tests + single-process).
 */
export async function claimPersonalTimelineJobId(jobId: string): Promise<boolean> {
  const url = getRedisUrl();
  if (!url) {
    if (localJobClaims.has(jobId)) return false;
    localJobClaims.add(jobId);
    return true;
  }
  const client = createRedis(url);
  try {
    const key = `${PERSONAL_TIMELINE_JOB_CLAIM_PREFIX}${jobId}`;
    const ok = await client.set(key, "1", "EX", JOB_CLAIM_TTL_SECONDS, "NX");
    return ok === "OK";
  } finally {
    await client.quit();
  }
}

/** Release a claim after failed LPUSH so the jobId can be retried. */
export async function releasePersonalTimelineJobId(jobId: string): Promise<void> {
  localJobClaims.delete(jobId);
  const url = getRedisUrl();
  if (!url) return;
  const client = createRedis(url);
  try {
    await client.del(`${PERSONAL_TIMELINE_JOB_CLAIM_PREFIX}${jobId}`);
  } finally {
    await client.quit();
  }
}

/**
 * Claim then LPUSH; on any enqueue failure release the claim so retries remain possible.
 * Successful queues keep the claim for dedupe.
 */
async function claimAndLpushJob(
  jobId: string,
  payload: PersonalTimelineJobPayload,
): Promise<boolean> {
  const claimed = await claimPersonalTimelineJobId(jobId);
  if (!claimed) return false;
  try {
    await lpushJob(payload);
    mockJobs.set(jobId, payload);
    return true;
  } catch (err) {
    await releasePersonalTimelineJobId(jobId);
    throw err;
  }
}

export function clearPersonalTimelineJobClaimsForTest(): void {
  localJobClaims.clear();
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

export function personalTimelineMultiJobId(
  roomId: string,
  eventAnchorId: string,
  npcId: string,
): string {
  return `pt-multi-${roomId}-${eventAnchorId}-${npcId}`;
}

export function personalTimelineRelJobId(
  roomId: string,
  eventAnchorId: string,
  npcId: string,
): string {
  return `pt-rel-${roomId}-${eventAnchorId}-${npcId}`;
}

export function personalTimelineEventJobId(
  roomId: string,
  eventAnchorId: string,
): string {
  return `pt-event-${roomId}-${eventAnchorId}`;
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
 * Returns jobId, or null only if payload invalid / already claimed.
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
  const ok = await claimAndLpushJob(jobId, payload);
  return ok ? jobId : null;
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
  const ok = await claimAndLpushJob(jobId, payload);
  return ok ? jobId : null;
}

/**
 * BIO-06: enqueue one multi-perspective seat (caller loops 12 with stagger offsets).
 */
export async function enqueuePersonalTimelineMultiJob(input: {
  roomId: string;
  npcId: string;
  eventAnchorId: string;
  factualSummary: string;
  aetherEpochMinute: number;
  staggerOffsetGameMinutes: number;
  hammerEpochMinute?: number;
}): Promise<string | null> {
  const jobId = personalTimelineMultiJobId(
    input.roomId,
    input.eventAnchorId,
    input.npcId,
  );
  const payload: PersonalTimelineMultiJobPayload = {
    kind: "multi",
    roomId: input.roomId,
    npcId: input.npcId,
    eventAnchorId: input.eventAnchorId,
    factualSummary: input.factualSummary,
    aetherEpochMinute: input.aetherEpochMinute,
    staggerOffsetGameMinutes: input.staggerOffsetGameMinutes,
    hammerEpochMinute: input.hammerEpochMinute,
    tag: "council",
    jobId,
    enqueuedAt: new Date().toISOString(),
  };
  const ok = await claimAndLpushJob(jobId, payload);
  return ok ? jobId : null;
}

/**
 * REL-07: enqueue one bilateral endpoint job.
 */
export async function enqueuePersonalTimelineRelJob(input: {
  roomId: string;
  npcId: string;
  counterpartNpcId: string;
  eventAnchorId: string;
  affectionDelta: number;
  aetherEpochMinute: number;
  historyAppend?: string;
}): Promise<string | null> {
  const jobId = personalTimelineRelJobId(
    input.roomId,
    input.eventAnchorId,
    input.npcId,
  );
  const payload: PersonalTimelineRelJobPayload = {
    kind: "rel",
    roomId: input.roomId,
    npcId: input.npcId,
    counterpartNpcId: input.counterpartNpcId,
    eventAnchorId: input.eventAnchorId,
    affectionDelta: input.affectionDelta,
    historyAppend: input.historyAppend,
    aetherEpochMinute: input.aetherEpochMinute,
    tag: "relationship",
    jobId,
    enqueuedAt: new Date().toISOString(),
  };
  const ok = await claimAndLpushJob(jobId, payload);
  return ok ? jobId : null;
}

/**
 * Non-vote dyad event (speak-mention / ambient co-presence).
 * Worker applies Δ then force-enqueues bilateral REL diaries.
 */
export async function enqueuePersonalTimelineEventJob(input: {
  roomId: string;
  npcId: string;
  counterpartNpcId: string;
  eventAnchorId: string;
  factualSummary: string;
  affectionDelta: number;
  aetherEpochMinute: number;
  historyAppend?: string;
}): Promise<string | null> {
  const jobId = personalTimelineEventJobId(input.roomId, input.eventAnchorId);
  const payload: PersonalTimelineEventJobPayload = {
    kind: "event",
    roomId: input.roomId,
    npcId: input.npcId,
    counterpartNpcId: input.counterpartNpcId,
    eventAnchorId: input.eventAnchorId,
    factualSummary: input.factualSummary,
    affectionDelta: input.affectionDelta,
    aetherEpochMinute: input.aetherEpochMinute,
    historyAppend: input.historyAppend,
    jobId,
    enqueuedAt: new Date().toISOString(),
  };
  const ok = await claimAndLpushJob(jobId, payload);
  return ok ? jobId : null;
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
  localJobClaims.clear();
}

export function clearMockPersonalTimelineJobs(): void {
  mockJobs.clear();
  localJobClaims.clear();
}
