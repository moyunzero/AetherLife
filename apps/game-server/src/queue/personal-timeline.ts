/**
 * Personal timeline polish job queue (D-SEED-01/04).
 * Skeleton inserts on room create; reflect/lore polish is async — never speak-slot LLM.
 */

import { Redis } from "ioredis";

export type PersonalTimelinePolishJobPayload = {
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

export const PERSONAL_TIMELINE_JOBS_KEY = "aetherlife:personal-timeline:jobs";

const mockJobs = new Map<string, PersonalTimelinePolishJobPayload>();

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
    ...input,
    jobId,
    enqueuedAt: new Date().toISOString(),
  };

  const url = getRedisUrl();
  if (url) {
    const client = createRedis(url);
    try {
      await client.lpush(PERSONAL_TIMELINE_JOBS_KEY, JSON.stringify(payload));
    } finally {
      await client.quit();
    }
  }

  mockJobs.set(jobId, payload);
  return jobId;
}

export function getMockPersonalTimelinePolishJob(
  jobId: string,
): PersonalTimelinePolishJobPayload | undefined {
  return mockJobs.get(jobId);
}

export function clearMockPersonalTimelinePolishJobs(): void {
  mockJobs.clear();
}
