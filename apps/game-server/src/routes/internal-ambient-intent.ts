import { Router, type Request, type Response } from "express";
import { isTargetIntent, safeParseAmbientIntent } from "@aetherlife/shared";
import { setIntent, type AmbientIntentTrigger } from "../ambient/intent-cache.js";
import { clearPendingNpcIntentJob } from "../queue/npc-ambient-intent.js";
import { requireWorkerAuth } from "./internal.js";
import { isTerrainWalkableInRegion } from "../world/region-walkability.js";

const VALID_TRIGGERS = new Set<AmbientIntentTrigger>(["segment_change", "speak_end"]);

function targetIntentWalkable(gx: number, gy: number): boolean {
  const walkable = isTerrainWalkableInRegion(gx, gy);
  return walkable !== false;
}

export function createInternalAmbientIntentRouter(): Router {
  const router = Router({ mergeParams: true });
  router.use(requireWorkerAuth);

  router.post("/:roomId/npc-intent/pending-clear", (req: Request, res: Response) => {
    const roomId = req.params.roomId;
    if (!roomId) {
      res.status(400).json({ ok: false, error: "missing roomId" });
      return;
    }

    const npcId = typeof req.body?.npcId === "string" ? req.body.npcId : "";
    if (!npcId) {
      res.status(400).json({ ok: false, error: "missing npcId" });
      return;
    }

    const jobId = typeof req.body?.jobId === "string" ? req.body.jobId : undefined;
    clearPendingNpcIntentJob(roomId, npcId, jobId);
    res.status(204).end();
  });

  router.post("/:roomId/npc-intent", (req: Request, res: Response) => {
    const roomId = req.params.roomId;
    if (!roomId) {
      res.status(400).json({ ok: false, error: "missing roomId" });
      return;
    }

    const npcId = typeof req.body?.npcId === "string" ? req.body.npcId : "";
    if (!npcId) {
      res.status(400).json({ ok: false, error: "missing npcId" });
      return;
    }

    const jobId = typeof req.body?.jobId === "string" ? req.body.jobId : undefined;

    const trigger = req.body?.trigger as AmbientIntentTrigger;
    if (!VALID_TRIGGERS.has(trigger)) {
      clearPendingNpcIntentJob(roomId, npcId, jobId);
      res.status(400).json({ ok: false, error: "invalid trigger" });
      return;
    }

    const gameMinute = Number(req.body?.gameMinute);
    if (!Number.isFinite(gameMinute) || gameMinute < 0 || gameMinute > 1439) {
      clearPendingNpcIntentJob(roomId, npcId, jobId);
      res.status(400).json({ ok: false, error: "invalid gameMinute" });
      return;
    }

    const parsed = safeParseAmbientIntent(req.body?.intent);
    if (!parsed.success) {
      clearPendingNpcIntentJob(roomId, npcId, jobId);
      res.status(400).json({ ok: false, error: "invalid intent schema" });
      return;
    }

    if (
      isTargetIntent(parsed.data) &&
      !targetIntentWalkable(parsed.data.target.gx, parsed.data.target.gy)
    ) {
      clearPendingNpcIntentJob(roomId, npcId, jobId);
      res.status(400).json({ ok: false, error: "target not walkable" });
      return;
    }

    const initiatorPlayerId =
      typeof req.body?.initiatorPlayerId === "string" ? req.body.initiatorPlayerId : undefined;

    setIntent(roomId, npcId, {
      intent: parsed.data,
      trigger,
      gameMinute,
      initiatorPlayerId,
    });
    clearPendingNpcIntentJob(roomId, npcId, jobId);

    res.status(204).end();
  });

  return router;
}
