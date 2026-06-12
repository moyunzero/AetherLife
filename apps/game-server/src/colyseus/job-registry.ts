import type { Room } from "colyseus";

export type JobMeta = {
  npcId: string;
  playerId: string;
  playerMessage: string;
};

type JobEntry = { room: Room; roomId: string; sessionId?: string } & Partial<JobMeta>;

const MAX_JOBS = 512;
const jobs = new Map<string, JobEntry>();

function evictOldestJobIfNeeded(): void {
  if (jobs.size < MAX_JOBS) return;
  const oldest = jobs.keys().next().value;
  if (oldest !== undefined) {
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
  jobs.set(jobId, { room, roomId, sessionId, ...meta });
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
