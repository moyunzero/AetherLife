import type { Room } from "colyseus";

export type JobMeta = {
  npcId: string;
  playerId: string;
  playerMessage: string;
};

type JobEntry = {
  room: Room;
  roomId: string;
  sessionId?: string;
  registeredAt: number;
} & Partial<JobMeta>;

const MAX_JOBS = 512;
/** Only evict jobs older than this to avoid dropping in-flight speak SSE handlers. */
export const MIN_JOB_AGE_MS = 60_000;
export { MAX_JOBS };

const jobs = new Map<string, JobEntry>();

function evictOldestJobIfNeeded(): void {
  if (jobs.size < MAX_JOBS) return;
  const now = Date.now();
  for (const [jobId, entry] of jobs) {
    if (now - entry.registeredAt >= MIN_JOB_AGE_MS) {
      jobs.delete(jobId);
      return;
    }
  }
  const oldest = jobs.keys().next().value;
  if (oldest !== undefined) {
    console.warn("[job-registry] at MAX_JOBS with no stale entries; evicting oldest", oldest);
    jobs.delete(oldest);
  }
}

export function registerJob(
  jobId: string,
  room: Room,
  roomId: string,
  sessionId?: string,
  meta?: JobMeta,
): void {
  evictOldestJobIfNeeded();
  jobs.set(jobId, { room, roomId, sessionId, registeredAt: Date.now(), ...meta });
}

export function unregisterJob(jobId: string): void {
  jobs.delete(jobId);
}

export function getJobRoom(jobId: string): Room | undefined {
  return jobs.get(jobId)?.room;
}

export function getJobEntry(jobId: string): JobEntry | undefined {
  return jobs.get(jobId);
}

/** Test helper */
export function clearJobRegistry(): void {
  jobs.clear();
}

/** Test helper — seed registry at capacity with controlled ages. */
export function registerJobForTest(
  jobId: string,
  room: Room,
  roomId: string,
  registeredAt: number,
): void {
  jobs.set(jobId, { room, roomId, registeredAt });
}

/** @internal */
export function jobRegistrySizeForTest(): number {
  return jobs.size;
}
