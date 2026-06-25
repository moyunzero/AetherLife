import { Router, type Request, type Response } from "express";
import { getColyseusRoom } from "../colyseus/room-registry.js";
import { forceEnqueueWorldVote } from "../world/world-vote-trigger.js";
import { requireWorkerAuth } from "./internal.js";

/**
 * Internal force-trigger for verify:phase25 Path B.
 * Requires worker Bearer auth. Enabled when VOTE_FORCE_TRIGGER=1 or body.force=true.
 */
export function createInternalWorldVoteTriggerRouter(): Router {
  const router = Router({ mergeParams: true });
  router.use(requireWorkerAuth);

  router.post("/:roomId/world-vote/trigger", async (req: Request, res: Response) => {
    const roomId = req.params.roomId;
    if (!roomId) {
      res.status(400).json({ ok: false, error: "missing roomId" });
      return;
    }

    const forceAllowed =
      process.env.VOTE_FORCE_TRIGGER === "1" || req.body?.force === true;
    if (!forceAllowed) {
      res.status(403).json({ ok: false, error: "force trigger disabled" });
      return;
    }

    const colyseusRoom = getColyseusRoom(roomId);
    const bodyMinute = Number(req.body?.gameMinute);
    const gameMinute =
      colyseusRoom?.state?.gameMinute ??
      (Number.isFinite(bodyMinute) ? bodyMinute : 360);

    const voteKind = req.body?.voteKind === "epoch" ? "epoch" : "regular";
    const jobId = await forceEnqueueWorldVote({ roomId, gameMinute, voteKind });
    if (!jobId) {
      res.status(409).json({ ok: false, error: "enqueue failed or deduped" });
      return;
    }

    res.status(202).json({ ok: true, jobId, voteKind, gameMinute });
  });

  return router;
}
