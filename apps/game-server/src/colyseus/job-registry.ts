import type { Room } from "colyseus";

type JobEntry = { room: Room; roomId: string; sessionId?: string };

const jobs = new Map<string, JobEntry>();

export function registerJob(
  jobId: string,
  room: Room,
  roomId: string,
  sessionId?: string,
): void {
  jobs.set(jobId, { room, roomId, sessionId });
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
