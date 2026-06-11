import { previewCasualSpeakStub } from "@aetherlife/shared";
import { Router, type Request, type Response } from "express";
import { registerJob } from "../colyseus/job-registry.js";
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

    const colyseusRoom = getColyseusRoom(roomId) as GameRoom | undefined;
    if (colyseusRoom?.isNpcSpeakBusy(npcId)) {
      res.status(409).json({ ok: false, error: "npc_busy" });
      return;
    }

    try {
      const casualStub = previewCasualSpeakStub(message);
      const jobId = await startNpcChatTurn(roomId, message, npcId, playerId, undefined, {
        casualPreviewEmitted: Boolean(casualStub),
      });
      if (colyseusRoom) {
        colyseusRoom.acquireNpcSpeakJob(npcId, jobId);
        registerJob(jobId, colyseusRoom, roomId, undefined, {
          npcId,
          playerId,
          playerMessage: message,
        });
      }
      if (casualStub) {
        emitJobEvent(jobId, "speakPartial", { text: casualStub, npcId });
      }
      res.json({ jobId });
    } catch (err) {
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
    subscribeJobEvents(req, res, jobId);
  });

  return router;
}

export { emitJobEvent };
