import { loreJobId } from "@aetherlife/shared";
import { Queue, type ConnectionOptions } from "bullmq";
import { Redis } from "ioredis";

export type ChunkLoreJobPayload = {
  worldId: string;
  mapRoomId: string;
  cx: number;
  cy: number;
  worldSeed: string;
  dominantBiome: string;
  walkableRatio: number;
  modelTier: "T0" | "T1";
  triggerPlayerId: string;
  jobId: string;
  enqueuedAt: string;
};

const QUEUE_NAME = "chunk-lore";
const BRIDGE_LIST_KEY = "aetherlife:chunk-lore:jobs";

let queue: Queue | null = null;
const mockJobs = new Map<string, ChunkLoreJobPayload>();

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

function getQueue(): Queue | null {
  const url = getRedisUrl();
  if (!url) return null;
  if (!queue) {
    queue = new Queue(QUEUE_NAME, { connection: createRedis(url) as ConnectionOptions });
  }
  return queue;
}

async function pushBridgeJob(payload: ChunkLoreJobPayload): Promise<void> {
  const url = getRedisUrl();
  if (!url) return;
  const client = createRedis(url);
  try {
    await client.lpush(BRIDGE_LIST_KEY, JSON.stringify(payload));
  } finally {
    await client.quit();
  }
}

export async function addChunkLoreJob(input: {
  worldId: string;
  mapRoomId: string;
  cx: number;
  cy: number;
  worldSeed: string;
  dominantBiome: string;
  walkableRatio: number;
  modelTier: "T0" | "T1";
  triggerPlayerId: string;
}): Promise<string> {
  const jobId = loreJobId(input.worldId, input.cx, input.cy);
  const payload: ChunkLoreJobPayload = {
    ...input,
    jobId,
    enqueuedAt: new Date().toISOString(),
  };

  const q = getQueue();
  if (q) {
    await q.add("generate", payload, { jobId });
    await pushBridgeJob(payload);
  }

  mockJobs.set(jobId, payload);
  return jobId;
}

export function getMockLoreJob(jobId: string): ChunkLoreJobPayload | undefined {
  return mockJobs.get(jobId);
}

export function clearMockLoreJobs(): void {
  mockJobs.clear();
}

export async function closeChunkLoreQueue(): Promise<void> {
  if (queue) {
    await queue.close();
    queue = null;
  }
}

export { BRIDGE_LIST_KEY, QUEUE_NAME };
