/**
 * NPC mutual-chat job queue (D-MUTUAL-07).
 * Tick enqueues only — worker drains LLM (plan 06). Mirror personal-timeline claim/LPUSH.
 */

import { Redis } from "ioredis";
import { normalizeEdgeIds } from "@aetherlife/shared";

export type NpcMutualChatJobPayload = {
  roomId: string;
  npcAId: string;
  npcBId: string;
  dayIndex: number;
  absoluteGameMinute: number;
  jobId: string;
  enqueuedAt: string;
};

export const NPC_MUTUAL_CHAT_JOBS_KEY = "aetherlife:npc-mutual-chat:jobs";

export const NPC_MUTUAL_CHAT_JOB_CLAIM_PREFIX =
  "aetherlife:npc-mutual-chat:job-claimed:";

const JOB_CLAIM_TTL_SECONDS = 60 * 60 * 24 * 14;

const mockJobs = new Map<string, NpcMutualChatJobPayload>();
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

export function npcMutualChatJobId(
  roomId: string,
  dayIndex: number,
  npcAId: string,
  npcBId: string,
): string {
  const { npcAId: a, npcBId: b } = normalizeEdgeIds(npcAId, npcBId);
  return `mc-${roomId}-${dayIndex}-${a}-${b}`;
}

export async function claimNpcMutualChatJobId(jobId: string): Promise<boolean> {
  const url = getRedisUrl();
  if (!url) {
    if (localJobClaims.has(jobId)) return false;
    localJobClaims.add(jobId);
    return true;
  }
  const client = createRedis(url);
  try {
    const key = `${NPC_MUTUAL_CHAT_JOB_CLAIM_PREFIX}${jobId}`;
    const ok = await client.set(key, "1", "EX", JOB_CLAIM_TTL_SECONDS, "NX");
    return ok === "OK";
  } finally {
    await client.quit();
  }
}

export async function releaseNpcMutualChatJobId(jobId: string): Promise<void> {
  localJobClaims.delete(jobId);
  const url = getRedisUrl();
  if (!url) return;
  const client = createRedis(url);
  try {
    await client.del(`${NPC_MUTUAL_CHAT_JOB_CLAIM_PREFIX}${jobId}`);
  } finally {
    await client.quit();
  }
}

async function lpushJob(payload: NpcMutualChatJobPayload): Promise<void> {
  const url = getRedisUrl();
  if (!url) return;
  const client = createRedis(url);
  try {
    await client.lpush(NPC_MUTUAL_CHAT_JOBS_KEY, JSON.stringify(payload));
  } finally {
    await client.quit();
  }
}

async function claimAndLpushJob(
  jobId: string,
  payload: NpcMutualChatJobPayload,
): Promise<boolean> {
  const claimed = await claimNpcMutualChatJobId(jobId);
  if (!claimed) return false;
  try {
    await lpushJob(payload);
    mockJobs.set(jobId, payload);
    return true;
  } catch (err) {
    await releaseNpcMutualChatJobId(jobId);
    throw err;
  }
}

/**
 * Claim then LPUSH mutual-chat job. Returns jobId or null if already claimed / invalid.
 */
export async function enqueueNpcMutualChatJob(input: {
  roomId: string;
  npcAId: string;
  npcBId: string;
  dayIndex: number;
  absoluteGameMinute: number;
}): Promise<string | null> {
  if (!input.roomId || input.npcAId === input.npcBId) return null;
  const { npcAId, npcBId } = normalizeEdgeIds(input.npcAId, input.npcBId);
  const jobId = npcMutualChatJobId(input.roomId, input.dayIndex, npcAId, npcBId);
  const payload: NpcMutualChatJobPayload = {
    roomId: input.roomId,
    npcAId,
    npcBId,
    dayIndex: input.dayIndex,
    absoluteGameMinute: input.absoluteGameMinute,
    jobId,
    enqueuedAt: new Date().toISOString(),
  };
  const ok = await claimAndLpushJob(jobId, payload);
  return ok ? jobId : null;
}

export function getMockNpcMutualChatJob(
  jobId: string,
): NpcMutualChatJobPayload | undefined {
  return mockJobs.get(jobId);
}

export function clearMockNpcMutualChatJobs(): void {
  mockJobs.clear();
  localJobClaims.clear();
}

export function clearNpcMutualChatJobClaimsForTest(): void {
  localJobClaims.clear();
}
