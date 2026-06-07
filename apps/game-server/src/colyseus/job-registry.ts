import type { Room } from "colyseus";

export type JobMeta = {
  npcId: string;
  playerId: string;
  playerMessage: string;
};

type JobEntry = { room: Room; roomId: string; sessionId?: string } & Partial<JobMeta>;

const jobs = new Map<string, JobEntry>();

export function registerJob(
  jobId: string,
  room: Room,
  roomId: string,
  sessionId?: string,
  meta?: JobMeta,
): void {
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
