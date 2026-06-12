import { previewCasualSpeakStub } from "@aetherlife/shared";
import { randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { registerJob, unregisterJob, getJobEntry } from "../colyseus/job-registry.js";
import { assertScopedPlayerRequest } from "../colyseus/bridge.js";
import {
  getContentBlockedResponse,
  startNpcChatTurn,
  validateChatMessage,
  validateChatNpcId,
} from "../colyseus/npc-chat.js";
import { getColyseusRoom } from "../colyseus/room-registry.js";
import type { GameRoom } from "../colyseus/GameRoom.js";
import { playerIdFromRequest } from "../http/player-id.js";
import { getOrCreate } from "../room/store.js";
import { emitJobEvent, subscribeJobEvents } from "../sse/hub.js";

export function createChatRouter(): Router {
  const router = Router();

  router.post("/:roomId/chat", async (req, res) => {
    const message = validateChatMessage(req.body?.message);
    if (!message) {
      res.status(400).json({ ok: false, error: "message must be a non-empty string up to 2000 chars" });
      return;
    }

    const blocked = getContentBlockedResponse(message);
    if (blocked) {
      res.status(400).json({ ok: false, ...blocked, error: blocked.message });
      return;
    }

    const { roomId } = req.params;
    const npcId = validateChatNpcId(roomId, req.body?.npcId);
    if (!npcId) {
      res.status(400).json({ ok: false, error: "npcId required and must match a room npc" });
      return;
    }

    getOrCreate(roomId);
    const playerId = playerIdFromRequest(req, req.body);
    const auth = assertScopedPlayerRequest(req, playerId, roomId);
    if (!auth.ok) {
      res.status(auth.status).json({ ok: false, error: auth.error });
      return;
    }

    const colyseusRoom = getColyseusRoom(roomId) as GameRoom | undefined;
    const jobId = randomUUID();
    if (colyseusRoom && !colyseusRoom.tryAcquireNpcSpeakJob(npcId, jobId)) {
      res.status(409).json({ ok: false, error: "npc_busy" });
      return;
    }

    let speakAcquired = Boolean(colyseusRoom);
    try {
      const casualStub = previewCasualSpeakStub(message);
      if (colyseusRoom) {
        registerJob(jobId, colyseusRoom, roomId, undefined, {
          npcId,
          playerId,
          playerMessage: message,
        });
      }
      if (casualStub) {
        emitJobEvent(jobId, "speakPartial", { text: casualStub, npcId });
      }
      await startNpcChatTurn(roomId, message, npcId, playerId, jobId, {
        casualPreviewEmitted: Boolean(casualStub),
      });
      res.json({ jobId });
    } catch (err) {
      if (colyseusRoom && speakAcquired) {
        colyseusRoom.clearSpeakInFlight(jobId, { enqueueAmbient: false });
        unregisterJob(jobId);
      }
      const error = err instanceof Error ? err.message : "chat failed";
      res.status(500).json({ ok: false, error });
    }
  });

  router.get("/:roomId/events", (req: Request, res: Response) => {
    const jobId = req.query.jobId;
    if (typeof jobId !== "string" || !jobId) {
      res.status(400).json({ ok: false, error: "jobId query required" });
      return;
    }
    const entry = getJobEntry(jobId);
    if (!entry) {
      res.status(404).json({ ok: false, error: "unknown job" });
      return;
    }
    const requester = playerIdFromRequest(req);
    if (!entry.playerId || entry.playerId !== requester) {
      res.status(403).json({ ok: false, error: "forbidden" });
      return;
    }
    subscribeJobEvents(req, res, jobId);
  });

  return router;
}

export { emitJobEvent };
