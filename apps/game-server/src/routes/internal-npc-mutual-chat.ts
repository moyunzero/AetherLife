import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { linkedEdgeSchema } from "@aetherlife/shared";
import {
  broadcastLinkedEdgesHint,
  broadcastRelationshipSync,
  presentNpcMutualChat,
} from "../world/relationship-broadcast.js";
import { requireWorkerAuth } from "./internal.js";

const presentBodySchema = z
  .object({
    npcAId: z.string().min(1).max(64),
    npcBId: z.string().min(1).max(64),
    npcAReasonZh: z.string().min(1).max(40),
    npcBReasonZh: z.string().min(1).max(40),
    bubbleText: z.string().min(1).max(40),
  })
  .strict();

const linkedHintBodySchema = z
  .object({
    linkedEdges: z.array(linkedEdgeSchema).min(1).max(8),
  })
  .strict();

export function createInternalNpcMutualChatRouter(): Router {
  const router = Router();
  router.use(requireWorkerAuth);

  router.post("/:roomId/npc-mutual-chat/present", (req: Request, res: Response) => {
    const roomId = req.params.roomId;
    if (!roomId) {
      res.status(400).json({ ok: false, error: "roomId required" });
      return;
    }

    const parsed = presentBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: parsed.error.flatten() });
      return;
    }

    const data = parsed.data;
    if (data.npcAId === data.npcBId) {
      res.status(400).json({ ok: false, error: "npcAId and npcBId must differ" });
      return;
    }

    try {
      const bubble = presentNpcMutualChat(roomId, data);
      try {
        broadcastRelationshipSync(roomId, { hasUpdate: true });
      } catch (err) {
        console.error("[npc-mutual-chat] relationshipSync failed", err);
      }
      res.json({ ok: true, bubble });
    } catch (err) {
      const message = err instanceof Error ? err.message : "present failed";
      res.status(500).json({ ok: false, error: message });
    }
  });

  router.post(
    "/:roomId/npc-mutual-chat/linked-edges-hint",
    (req: Request, res: Response) => {
      const roomId = req.params.roomId;
      if (!roomId) {
        res.status(400).json({ ok: false, error: "roomId required" });
        return;
      }

      const parsed = linkedHintBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ ok: false, error: parsed.error.flatten() });
        return;
      }

      try {
        broadcastLinkedEdgesHint(roomId, { linkedEdges: parsed.data.linkedEdges });
        res.json({ ok: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : "linked-edges-hint failed";
        res.status(500).json({ ok: false, error: message });
      }
    },
  );

  return router;
}
