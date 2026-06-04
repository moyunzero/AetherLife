import { Router, type Request, type Response } from "express";
import { findNpc } from "@aetherlife/shared";
import { addNpcTurnJob } from "../queue/npc-turn.js";
import { MemoryService } from "../memory/service.js";
import { getOrCreate } from "../room/store.js";
import { emitJobEvent, subscribeJobEvents } from "../sse/hub.js";

function validateMessage(message: unknown): string | null {
  if (typeof message !== "string") return null;
  const trimmed = message.trim();
  if (!trimmed || trimmed.length > 2000) return null;
  return trimmed;
}

function validateNpcId(roomId: string, npcId: unknown): string | null {
  if (typeof npcId !== "string" || !npcId.trim()) return null;
  const room = getOrCreate(roomId);
  return findNpc(room.state, npcId) ? npcId : null;
}

export function createChatRouter(): Router {
  const router = Router();

  router.post("/:roomId/chat", async (req, res) => {
    const message = validateMessage(req.body?.message);
    if (!message) {
      res.status(400).json({ ok: false, error: "message must be a non-empty string up to 2000 chars" });
      return;
    }

    const { roomId } = req.params;
    const npcId = validateNpcId(roomId, req.body?.npcId);
    if (!npcId) {
      res.status(400).json({ ok: false, error: "npcId required and must match a room npc" });
      return;
    }

    getOrCreate(roomId);

    try {
      await MemoryService.getInstance().appendPlayerMemory(roomId, message, npcId);
      const jobId = await addNpcTurnJob({ roomId, playerMessage: message, npcId });
      emitJobEvent(jobId, "thinking", { status: "queued", npcId });
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
