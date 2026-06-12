import { randomUUID } from "node:crypto";
import { Queue, type ConnectionOptions } from "bullmq";
import { Redis } from "ioredis";

export type DialogueTurnPayload = { role: "player" | "npc"; text: string };

export type NpcTurnJobPayload = {
  roomId: string;
  jobId: string;
  npcId: string;
  playerId: string;
  playerMessage: string;
  recentTurns?: DialogueTurnPayload[];
  enqueuedAt: string;
  /** game-server already emitted speakPartial stub for CASUAL fast lane */
  casualPreviewEmitted?: boolean;
};

const QUEUE_NAME = "npc-turn";
const BRIDGE_LIST_KEY = "aetherlife:npc-turn:jobs";

let queue: Queue | null = null;

function getRedisUrl(): string | undefined {
  return process.env.REDIS_URL;
}

/** ioredis ignores `{ url }` in options and falls back to localhost — pass URL as first arg. */
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

/** Push payload for Python worker bridge (LPUSH + worker BRPOP = FIFO) alongside BullMQ. */
async function pushBridgeJob(payload: NpcTurnJobPayload): Promise<void> {
  const url = getRedisUrl();
  if (!url) return;
  const client = createRedis(url);
  try {
    await client.lpush(BRIDGE_LIST_KEY, JSON.stringify(payload));
  } finally {
    await client.quit();
  }
}

export async function addNpcTurnJob(input: {
  roomId: string;
  playerMessage: string;
  npcId: string;
  playerId: string;
  recentTurns?: DialogueTurnPayload[];
  jobId?: string;
  casualPreviewEmitted?: boolean;
}): Promise<string> {
  const jobId = input.jobId ?? randomUUID();
  const payload: NpcTurnJobPayload = {
    roomId: input.roomId,
    jobId,
    npcId: input.npcId,
    playerId: input.playerId,
    playerMessage: input.playerMessage,
    recentTurns: input.recentTurns,
    enqueuedAt: new Date().toISOString(),
    ...(input.casualPreviewEmitted ? { casualPreviewEmitted: true } : {}),
  };

  const q = getQueue();
  if (!q) {
    mockJobs.set(jobId, payload);
    if (process.env.NODE_ENV === "test") {
      return jobId;
    }
    throw new Error("REDIS_URL not configured; NPC speak queue unavailable");
  }

  await q.add("turn", payload, { jobId });
  await pushBridgeJob(payload);

  mockJobs.set(jobId, payload);
  return jobId;
}

export function getMockJob(jobId: string): NpcTurnJobPayload | undefined {
  return mockJobs.get(jobId);
}

const mockJobs = new Map<string, NpcTurnJobPayload>();

/** Test helper */
export function clearMockJobs(): void {
  mockJobs.clear();
}

export async function closeNpcTurnQueue(): Promise<void> {
  if (queue) {
    await queue.close();
    queue = null;
  }
}
