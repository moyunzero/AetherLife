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

/**
 * Creates a unique key by joining a room ID and NPC ID with a colon.
 *
 * @param roomId - The room identifier
 * @param npcId - The NPC identifier
 * @returns A string in the format `roomId:npcId`
 */
function pendingKey(roomId: string, npcId: string): string {
  return `${roomId}:${npcId}`;
}

/**
 * Reads the Redis connection URL from the process environment.
 *
 * @returns The value of the `REDIS_URL` environment variable, or `undefined` if it is not set.
 */
function getRedisUrl(): string | undefined {
  return process.env.REDIS_URL;
}

/**
 * Create an ioredis client connected to the provided Redis URL.
 *
 * The client will have `maxRetriesPerRequest` set to `null` and will register an `"error"` handler
 * that logs `"[redis]"` followed by the error message to stderr.
 *
 * @param url - Redis connection URL (e.g., `redis://...`)
 * @returns An ioredis `Redis` client instance
 */
function createRedis(url: string): Redis {
  const client = new Redis(url, { maxRetriesPerRequest: null });
  client.on("error", (err) => {
    console.error("[redis]", err.message);
  });
  return client;
}

/**
 * Lazily initializes and returns the BullMQ queue for NPC ambient intent jobs, or null when Redis is not configured.
 *
 * @returns The existing or newly created `Queue` instance for `QUEUE_NAME`, or `null` if `REDIS_URL` is unset.
 */
function getQueue(): Queue | null {
  const url = getRedisUrl();
  if (!url) return null;
  if (!queue) {
    queue = new Queue(QUEUE_NAME, { connection: createRedis(url) as ConnectionOptions });
  }
  return queue;
}

/**
 * Appends the ambient intent job payload to the Redis bridge list when a Redis URL is configured.
 *
 * If `REDIS_URL` is unset, the function does nothing. When configured, the payload is JSON-stringified and pushed
 * onto the `BRIDGE_LIST_KEY` list and the Redis client is always closed before the function completes.
 *
 * @param payload - The ambient intent job payload to append to the bridge list
 */
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

/**
 * Builds a stable job identifier for an NPC ambient-intent job.
 *
 * @param roomId - The room identifier
 * @param npcId - The NPC identifier
 * @param trigger - The trigger for the job (e.g., `"segment_change"` or `"speak_end"`)
 * @param gameMinute - The in-game minute used to make the identifier unique
 * @returns A job id string in the form `ambient-{roomId}-{npcId}-{trigger}-{gameMinute}`
 */
export function ambientIntentJobId(
  roomId: string,
  npcId: string,
  trigger: string,
  gameMinute: number,
): string {
  // BullMQ custom jobId must not contain ":" (see Job.validateOptions).
  return `ambient-${roomId}-${npcId}-${trigger}-${gameMinute}`;
}

/**
 * Create or update a pending ambient-intent job for an NPC and record it for processing.
 *
 * If a pending job for the same room+npc already exists and has the same `gameMinute` and
 * `trigger`, the existing jobId is returned without enqueueing a duplicate. If a pending job
 * exists but differs in `gameMinute` or `trigger`, the pending mapping is replaced with the new job.
 *
 * When a BullMQ queue is available, the job payload is added to the queue and the same payload
 * is appended to the bridge Redis list for downstream consumers. In all cases the payload is stored
 * in the in-memory mock job map and the pending mapping is updated.
 *
 * @param input - Job input containing room and NPC identifiers, timing, segment data, trigger, and optional initiatorPlayerId
 * @returns The computed `jobId` for the enqueued or recorded ambient-intent job
 */
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

/**
 * Clears the pending ambient-intent job mapping for the specified NPC in a room.
 *
 * If `jobId` is provided, the mapping is removed only when the currently pending job ID matches it; otherwise the mapping is removed unconditionally. If no mapping exists or the IDs don't match, the function does nothing.
 *
 * @param roomId - The room identifier
 * @param npcId - The NPC identifier
 * @param jobId - Optional job ID to match before clearing; when provided, the mapping is cleared only if it equals the currently pending job ID
 */
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

/**
 * Retrieve the in-memory ambient intent job payload associated with a job ID.
 *
 * @param jobId - The job identifier (as produced by `ambientIntentJobId` or `addNpcAmbientIntentJob`)
 * @returns The stored `NpcAmbientIntentJobPayload` for `jobId`, or `undefined` if no matching payload exists
 */
export function getMockAmbientIntentJob(jobId: string): NpcAmbientIntentJobPayload | undefined {
  return mockJobs.get(jobId);
}

/**
 * Removes all in-memory mock ambient intent jobs and clears the pending NPC mappings.
 *
 * This resets the module's test/mock state by emptying the internal `mockJobs` map and the `pendingByNpc` map.
 */
export function clearMockAmbientIntentJobs(): void {
  mockJobs.clear();
  pendingByNpc.clear();
}

/**
 * Closes the NPC ambient-intent queue if it has been created and clears the cached queue reference.
 */
export async function closeNpcAmbientIntentQueue(): Promise<void> {
  if (queue) {
    await queue.close();
    queue = null;
  }
}

export { BRIDGE_LIST_KEY, QUEUE_NAME };
