import { Router, type Request, type Response } from "express";
import { z } from "zod";
import {
  COLLECTIVE_EVENT_KINDS,
  clampLlmRefineDelta,
  type CollectiveEventKind,
} from "@aetherlife/shared";
import { CollectiveService } from "../collective/service.js";
import { getOrCreate } from "../room/store.js";
import { requireWorkerAuth } from "./internal.js";

const workerSocialBodySchema = z.object({
  roomId: z.string().min(1),
  npcId: z.string().min(1),
  playerId: z.string().min(1),
  kind: z.enum(COLLECTIVE_EVENT_KINDS),
  summary: z.string().min(1).max(80),
  deltaScore: z.number().int().min(-100).max(100),
});

export function createInternalCollectiveRouter(): Router {
  const router = Router();

  router.post("/:roomId/collective-events", requireWorkerAuth, async (req: Request, res: Response) => {
    const parsed = workerSocialBodySchema.safeParse({
      roomId: req.params.roomId,
      ...req.body,
    });
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: parsed.error.flatten() });
      return;
    }

    const { roomId, npcId, playerId, kind, summary } = parsed.data;
    const deltaScore = clampLlmRefineDelta(parsed.data.deltaScore);
    const record = getOrCreate(roomId);
    const npcPositions = new Map(
      record.state.npcs.map((n) => [n.id, { x: n.x, y: n.y }] as const),
    );

    const svc = CollectiveService.getInstance();
    const result = await svc.recordWorkerEvent({
      roomId,
      npcId,
      kind: kind as CollectiveEventKind,
      summary,
      playerIds: [playerId],
      deltaScore,
      npcPositions,
    });

    const ctx = await svc.getCollectiveContext(roomId, npcId, playerId);
    res.json({
      ok: true,
      eventId: result.eventId,
      band: ctx.band,
      effectiveScore: ctx.effectiveScore,
      playerReputation: ctx.playerReputation,
    });
  });

  return router;
}
