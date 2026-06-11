import { Router, type Request, type Response } from "express";
import { isTargetIntent, safeParseAmbientIntent } from "@aetherlife/shared";
import { setIntent, type AmbientIntentTrigger } from "../ambient/intent-cache.js";
import { clearPendingNpcIntentJob } from "../queue/npc-ambient-intent.js";
import { requireWorkerAuth } from "./internal.js";
import { isTerrainWalkableInRegion } from "../world/region-walkability.js";

const VALID_TRIGGERS = new Set<AmbientIntentTrigger>(["segment_change", "speak_end"]);

/**
 * Determine whether the target tile at the given region coordinates can be traversed.
 *
 * @param gx - The region's x-coordinate for the target tile
 * @param gy - The region's y-coordinate for the target tile
 * @returns `true` if the tile at (`gx`, `gy`) is walkable, `false` otherwise
 */
function targetIntentWalkable(gx: number, gy: number): boolean {
  const walkable = isTerrainWalkableInRegion(gx, gy);
  return walkable !== false;
}

/**
 * Create an authenticated internal Express router for handling NPC ambient intent operations.
 *
 * Exposes two POST endpoints:
 * - POST /:roomId/npc-intent/pending-clear: clears a pending NPC ambient intent job for the given room and NPC.
 * - POST /:roomId/npc-intent: validates and sets an NPC ambient intent (validates trigger, gameMinute, intent schema,
 *   and target walkability for target intents) and clears any related pending job on success or validation failure.
 *
 * @returns An Express Router configured with worker authentication and the NPC ambient intent routes.
 */
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
