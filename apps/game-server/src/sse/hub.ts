import type { Request, Response } from "express";

export type JobEventType = "thinking" | "done" | "error";

type BufferedEvent = { type: JobEventType; data: unknown };

const subscribers = new Map<string, Set<Response>>();
const eventBuffer = new Map<string, BufferedEvent[]>();
const bufferTimers = new Map<string, ReturnType<typeof setTimeout>>();

const TERMINAL_EVENTS: ReadonlySet<JobEventType> = new Set(["done", "error"]);
const BUFFER_TTL_MS = 5 * 60 * 1000;

function writeEvent(res: Response, type: JobEventType, data: unknown): void {
  res.write(`event: ${type}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function scheduleBufferCleanup(jobId: string): void {
  const existing = bufferTimers.get(jobId);
  if (existing) clearTimeout(existing);
  bufferTimers.set(
    jobId,
    setTimeout(() => {
      eventBuffer.delete(jobId);
      bufferTimers.delete(jobId);
    }, BUFFER_TTL_MS),
  );
}

export function emitJobEvent(jobId: string, type: JobEventType, data: unknown): void {
  let buffer = eventBuffer.get(jobId);
  if (!buffer) {
    buffer = [];
    eventBuffer.set(jobId, buffer);
  }
  buffer.push({ type, data });

  const clients = subscribers.get(jobId);
  if (clients?.size) {
    for (const res of clients) {
      writeEvent(res, type, data);
    }
  }

  if (TERMINAL_EVENTS.has(type)) {
    scheduleBufferCleanup(jobId);
  }
}

export function subscribeJobEvents(req: Request, res: Response, jobId: string): void {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  let clients = subscribers.get(jobId);
  if (!clients) {
    clients = new Set();
    subscribers.set(jobId, clients);
  }
  clients.add(res);

  const buffered = eventBuffer.get(jobId);
  if (buffered) {
    for (const event of buffered) {
      writeEvent(res, event.type, event.data);
    }
  }

  const heartbeat = setInterval(() => {
    res.write(": heartbeat\n\n");
  }, 15_000);

  const cleanup = () => {
    clearInterval(heartbeat);
    clients?.delete(res);
    if (clients?.size === 0) {
      subscribers.delete(jobId);
    }
  };

  req.on("close", cleanup);
  req.on("aborted", cleanup);
}

/** Test helper — read buffered events without opening an SSE connection */
export function peekBufferedJobEvents(jobId: string): BufferedEvent[] {
  return [...(eventBuffer.get(jobId) ?? [])];
}

/** Test helper */
export function clearJobSubscribers(): void {
  subscribers.clear();
  eventBuffer.clear();
  for (const timer of bufferTimers.values()) {
    clearTimeout(timer);
  }
  bufferTimers.clear();
}
