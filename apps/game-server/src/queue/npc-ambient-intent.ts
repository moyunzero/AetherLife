import { Queue, type ConnectionOptions } from "bullmq";
import { Redis } from "ioredis";

export type AmbientIntentSegmentPayload = {
  zoneId: string;
  activityKey: string;
  mobility: string;
  fromMinute?: number;
  toMinute?: number;
};

export type NpcAmbientIntentJobPayload = {
  roomId: string;
  npcId: string;
  gameMinute: number;
  segment: AmbientIntentSegmentPayload;
  trigger: "segment_change" | "speak_end";
  jobId: string;
  enqueuedAt: string;
  /** Last speak initiator for C-06 join_vicinity on speak_end. */
  initiatorPlayerId?: string;
};

const QUEUE_NAME = "npc-ambient-intent";
const BRIDGE_LIST_KEY = "aetherlife:npc-ambient-intent:jobs";

let queue: Queue | null = null;
const mockJobs = new Map<string, NpcAmbientIntentJobPayload>();
const pendingByNpc = new Map<string, string>();

function pendingKey(roomId: string, npcId: string): string {
  return `${roomId}:${npcId}`;
}

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

async function pushBridgeJob(payload: NpcAmbientIntentJobPayload): Promise<void> {
  const url = getRedisUrl();
  if (!url) return;
  const client = createRedis(url);
  try {
    await client.lpush(BRIDGE_LIST_KEY, JSON.stringify(payload));
  } finally {
    await client.quit();
  }
}

export function ambientIntentJobId(
  roomId: string,
  npcId: string,
  trigger: string,
  gameMinute: number,
): string {
  // BullMQ custom jobId must not contain ":" (see Job.validateOptions).
  return `ambient-${roomId}-${npcId}-${trigger}-${gameMinute}`;
}

export async function addNpcAmbientIntentJob(input: {
  roomId: string;
  npcId: string;
  gameMinute: number;
  segment: AmbientIntentSegmentPayload;
  trigger: "segment_change" | "speak_end";
  initiatorPlayerId?: string;
}): Promise<string | null> {
  const pending = pendingKey(input.roomId, input.npcId);
  const existingPending = pendingByNpc.get(pending);
  if (existingPending) {
    const existing = mockJobs.get(existingPending);
    if (
      existing &&
      (existing.gameMinute !== input.gameMinute || existing.trigger !== input.trigger)
    ) {
      console.warn(
        `[npc-ambient-intent] replacing stale pending room=${input.roomId} npc=${input.npcId} ` +
          `old=${existingPending} trigger=${existing.trigger} minute=${existing.gameMinute}`,
      );
      pendingByNpc.delete(pending);
    } else {
      return existingPending;
    }
  }

  const jobId = ambientIntentJobId(input.roomId, input.npcId, input.trigger, input.gameMinute);
  const payload: NpcAmbientIntentJobPayload = {
    ...input,
    jobId,
    enqueuedAt: new Date().toISOString(),
  };

  const q = getQueue();
  if (q) {
    await q.add("plan", payload, { jobId });
    await pushBridgeJob(payload);
  }

  mockJobs.set(jobId, payload);
  pendingByNpc.set(pending, jobId);
  return jobId;
}

export function clearPendingNpcIntentJob(
  roomId: string,
  npcId: string,
  jobId?: string,
): void {
  const key = pendingKey(roomId, npcId);
  const pending = pendingByNpc.get(key);
  if (!pending) return;
  if (jobId && pending !== jobId) return;
  pendingByNpc.delete(key);
}

export function getMockAmbientIntentJob(jobId: string): NpcAmbientIntentJobPayload | undefined {
  return mockJobs.get(jobId);
}

export function clearMockAmbientIntentJobs(): void {
  mockJobs.clear();
  pendingByNpc.clear();
}

export async function closeNpcAmbientIntentQueue(): Promise<void> {
  if (queue) {
    await queue.close();
    queue = null;
  }
}

export { BRIDGE_LIST_KEY, QUEUE_NAME };
