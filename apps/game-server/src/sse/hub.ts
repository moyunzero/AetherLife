import type { Request, Response } from "express";
import type { StatePatchPayload } from "@aetherlife/shared";
import { COLYSEUS_SERVER_MESSAGES } from "@aetherlife/shared";
import type { GameRoom } from "../colyseus/GameRoom.js";
import { getJobEntry, unregisterJob } from "../colyseus/job-registry.js";
import { appendCompletedTurn } from "../npc/dialogue-session.js";
import { getOrCreate, setState } from "../room/store.js";
import { applyMapAndBumpVersion } from "../colyseus/version.js";
import { setNpcSpeakPhase } from "../colyseus/speak-schema.js";
import type { RoomState } from "@aetherlife/shared";
import { maybeEnqueueDyadFromSpeak } from "../world/personal-timeline-dyad.js";
import { getRoomVoteState } from "../world/world-vote-state.js";

export type JobEventType = "thinking" | "speakPartial" | "done" | "error";

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

function sendToClient(
  room: import("colyseus").Room,
  sessionId: string,
  type: string,
  payload: unknown,
): void {
  const client = room.clients.find((c) => c.sessionId === sessionId);
  if (client) client.send(type, payload);
}

function broadcastPatch(
  room: import("colyseus").Room,
  jobId: string,
  patch: StatePatchPayload,
): void {
  room.broadcast(COLYSEUS_SERVER_MESSAGES.patch, { jobId, ...patch });
}

function applyDoneStateToRoom(roomId: string, room: import("colyseus").Room, state: RoomState): StatePatchPayload | null {
  const colyseusRoom = room as unknown as GameRoom;
  if (!colyseusRoom.state) return null;
  setState(roomId, state);
  const { state: mapState } = getOrCreate(roomId);
  const { stateVersion, delta } = applyMapAndBumpVersion(
    colyseusRoom.state as import("../colyseus/schema.js").GameRoomState,
    mapState,
  );
  return { stateVersion, delta };
}

function routeColyseusEvent(jobId: string, type: JobEventType, data: unknown): void {
  const entry = getJobEntry(jobId);
  if (!entry) return;

  const base =
    typeof data === "object" && data !== null ? { jobId, ...data } : { jobId, data };
  const { room, sessionId, roomId } = entry;

  if (type === "thinking") {
    const npcId =
      typeof data === "object" && data !== null && typeof (data as Record<string, unknown>).npcId === "string"
        ? ((data as Record<string, unknown>).npcId as string)
        : undefined;
    if (npcId) {
      setNpcSpeakPhase(roomId, npcId, "thinking");
    }
    if (sessionId) {
      sendToClient(room, sessionId, COLYSEUS_SERVER_MESSAGES.thinking, base);
    }
    return;
  }

  if (type === "speakPartial") {
    const npcId =
      typeof data === "object" && data !== null && typeof (data as Record<string, unknown>).npcId === "string"
        ? ((data as Record<string, unknown>).npcId as string)
        : undefined;
    if (npcId) {
      setNpcSpeakPhase(roomId, npcId, "speaking");
    }
    if (sessionId) {
      sendToClient(room, sessionId, COLYSEUS_SERVER_MESSAGES.speakPartial, base);
    }
    return;
  }

  if (type === "error") {
    if (sessionId) {
      sendToClient(room, sessionId, COLYSEUS_SERVER_MESSAGES.error, base);
    }
    return;
  }

  if (type === "done") {
    const payload = base as Record<string, unknown>;
    const npcId = typeof payload.npcId === "string" ? payload.npcId : undefined;
    const snapshot = payload.state as RoomState | undefined;
    const reply = typeof payload.reply === "string" ? payload.reply.trim() : "";

    if (
      reply &&
      entry.npcId &&
      entry.playerId &&
      entry.playerMessage &&
      npcId
    ) {
      appendCompletedTurn({
        roomId: entry.roomId,
        playerId: entry.playerId,
        npcId: entry.npcId,
        playerMessage: entry.playerMessage,
        npcReply: reply,
      });
      const abs = getRoomVoteState(entry.roomId).absoluteGameMinute;
      void maybeEnqueueDyadFromSpeak({
        roomId: entry.roomId,
        speakerNpcId: entry.npcId,
        playerMessage: entry.playerMessage,
        npcReply: reply,
        absoluteGameMinute: abs,
      }).catch((err) => {
        console.error("[hub] personal-timeline dyad speak enqueue failed", err);
      });
    }

    if (snapshot && typeof snapshot === "object") {
      const patch = applyDoneStateToRoom(roomId, room, snapshot);
      if (patch) {
        broadcastPatch(room, jobId, { ...patch, npcId });
      }
    }

    if (sessionId) {
      sendToClient(room, sessionId, COLYSEUS_SERVER_MESSAGES.done, base);
    }
    return;
  }
}

export function emitJobEvent(jobId: string, type: JobEventType, data: unknown): void {
  routeColyseusEvent(jobId, type, data);

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
    const entry = getJobEntry(jobId);
    if (entry?.room) {
      const gateRejected =
        type === "done" &&
        typeof data === "object" &&
        data !== null &&
        (data as Record<string, unknown>).gateRejected === true;
      (entry.room as unknown as GameRoom).clearSpeakInFlight?.(jobId, {
        enqueueAmbient: type === "done" && !gateRejected,
      });
    }
    scheduleBufferCleanup(jobId);
    unregisterJob(jobId);
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