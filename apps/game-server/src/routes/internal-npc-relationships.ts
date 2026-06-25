import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { relationshipDeltaInputSchema } from "@aetherlife/shared";
import {
  applyRelationshipDeltas,
  listRelationshipsForRoom,
} from "../world/npc-relationships-repository.js";
import { requireWorkerAuth } from "./internal.js";

const applyDeltasBodySchema = z
  .object({
    deltas: z.array(relationshipDeltaInputSchema).min(1).max(66),
    voteEpoch: z.string().min(1).optional(),
  })
  .strict();

export function createInternalNpcRelationshipsRouter(): Router {
  const router = Router();
  router.use(requireWorkerAuth);

  router.get("/:roomId/npc-relationships", async (req: Request, res: Response) => {
    const roomId = req.params.roomId;
    if (!roomId) {
      res.status(400).json({ ok: false, error: "roomId required" });
      return;
    }

    const npcId = typeof req.query.npcId === "string" ? req.query.npcId.trim() : undefined;
    const limitRaw = typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;
    const limit =
      limitRaw != null && Number.isFinite(limitRaw) && limitRaw > 0
        ? Math.min(20, Math.trunc(limitRaw))
        : undefined;

    try {
      const edges = await listRelationshipsForRoom(roomId, { npcId, limit });
      res.json({ ok: true, edges });
    } catch (err) {
      const message = err instanceof Error ? err.message : "list failed";
      res.status(500).json({ ok: false, error: message });
    }
  });

  router.post(
    "/:roomId/npc-relationships/apply-deltas",
    async (req: Request, res: Response) => {
      const roomId = req.params.roomId;
      if (!roomId) {
        res.status(400).json({ ok: false, error: "roomId required" });
        return;
      }

      const parsed = applyDeltasBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ ok: false, error: parsed.error.flatten() });
        return;
      }

      try {
        const result = await applyRelationshipDeltas({
          roomId,
          deltas: parsed.data.deltas,
          voteEpoch: parsed.data.voteEpoch,
        });
        res.json({ ok: true, linkedEdges: result.linkedEdges });
      } catch (err) {
        const message = err instanceof Error ? err.message : "apply-deltas failed";
        res.status(500).json({ ok: false, error: message });
      }
    },
  );

  return router;
}
