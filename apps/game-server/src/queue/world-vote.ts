import { Queue, type ConnectionOptions } from "bullmq";
import { Redis } from "ioredis";
import type { CouncilDeliberationVoteKind } from "@aetherlife/shared";

export type WorldVoteJobPayload = {
  roomId: string;
  voteKind: CouncilDeliberationVoteKind;
  gameMinute: number;
  jobId: string;
  enqueuedAt: string;
  proposerIndex: number;
  debateRoundsMax: number;
};

const QUEUE_NAME = "world-vote";
const BRIDGE_LIST_KEY = "aetherlife:world-vote:jobs";

let queue: Queue | null = null;
const mockJobs = new Map<string, WorldVoteJobPayload>();
const pendingByRoom = new Map<string, string>();

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

async function pushBridgeJob(payload: WorldVoteJobPayload): Promise<void> {
  const url = getRedisUrl();
  if (!url) return;
  const client = createRedis(url);
  try {
    await client.lpush(BRIDGE_LIST_KEY, JSON.stringify(payload));
  } finally {
    await client.quit();
  }
}

export function worldVoteJobId(
  roomId: string,
  voteKind: CouncilDeliberationVoteKind,
  gameMinute: number,
): string {
  return `vote-${roomId}-${voteKind}-${gameMinute}`;
}

export async function addWorldVoteJob(input: {
  roomId: string;
  voteKind: CouncilDeliberationVoteKind;
  gameMinute: number;
  proposerIndex: number;
  debateRoundsMax: number;
}): Promise<string | null> {
  const existingPending = pendingByRoom.get(input.roomId);
  if (existingPending) {
    const existing = mockJobs.get(existingPending);
    if (
      existing &&
      existing.voteKind === input.voteKind &&
      existing.gameMinute === input.gameMinute
    ) {
      return existingPending;
    }
    console.warn(
      `[world-vote] replacing stale pending room=${input.roomId} ` +
        `old=${existingPending} kind=${existing?.voteKind} minute=${existing?.gameMinute}`,
    );
    pendingByRoom.delete(input.roomId);
  }

  const jobId = worldVoteJobId(input.roomId, input.voteKind, input.gameMinute);
  const payload: WorldVoteJobPayload = {
    roomId: input.roomId,
    voteKind: input.voteKind,
    gameMinute: input.gameMinute,
    proposerIndex: input.proposerIndex,
    debateRoundsMax: input.debateRoundsMax,
    jobId,
    enqueuedAt: new Date().toISOString(),
  };

  const q = getQueue();
  if (q) {
    await q.add("deliberate", payload, { jobId });
    await pushBridgeJob(payload);
  }

  mockJobs.set(jobId, payload);
  pendingByRoom.set(input.roomId, jobId);
  return jobId;
}

export function clearWorldVotePending(roomId: string, jobId?: string): void {
  const pending = pendingByRoom.get(roomId);
  if (!pending) return;
  if (jobId && pending !== jobId) return;
  pendingByRoom.delete(roomId);
}

export function getMockWorldVoteJob(jobId: string): WorldVoteJobPayload | undefined {
  return mockJobs.get(jobId);
}

export function clearMockWorldVoteJobs(): void {
  mockJobs.clear();
  pendingByRoom.clear();
}

export async function closeWorldVoteQueue(): Promise<void> {
  if (queue) {
    await queue.close();
    queue = null;
  }
}

export { BRIDGE_LIST_KEY, QUEUE_NAME };
