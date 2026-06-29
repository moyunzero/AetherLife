import { Router, type Request, type Response } from "express";
import { getColyseusRoom } from "../colyseus/room-registry.js";
import {
  forceEnqueueWorldVote,
  maybeEnqueueDeliberationContinuation,
} from "../world/world-vote-trigger.js";
import {
  getActiveDeliberation,
  getRoomVoteState,
  tickRoomVoteClock,
} from "../world/world-vote-state.js";
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
    const debateRaw = Number(req.body?.debateRoundsMax);
    const debateRoundsMax =
      Number.isFinite(debateRaw) && debateRaw >= 1 && debateRaw <= 3
        ? Math.trunc(debateRaw)
        : undefined;
    const instant =
      typeof req.body?.instant === "boolean"
        ? req.body.instant
        : undefined;
    const jobId = await forceEnqueueWorldVote({
      roomId,
      gameMinute,
      voteKind,
      debateRoundsMax,
      instant,
    });
    if (!jobId) {
      res.status(409).json({ ok: false, error: "enqueue failed or deduped" });
      return;
    }

    res.status(202).json({ ok: true, jobId, voteKind, gameMinute });
  });

  /** Dev/verify: advance vote clock and enqueue deliberation continuation when due. */
  router.post("/:roomId/world-vote/advance-clock", async (req: Request, res: Response) => {
    const roomId = req.params.roomId;
    if (!roomId) {
      res.status(400).json({ ok: false, error: "missing roomId" });
      return;
    }
    const forceAllowed =
      process.env.VOTE_FORCE_TRIGGER === "1" || req.body?.force === true;
    if (!forceAllowed) {
      res.status(403).json({ ok: false, error: "advance-clock disabled" });
      return;
    }

    const ticksRaw = Number(req.body?.ticks);
    const ticks =
      Number.isFinite(ticksRaw) && ticksRaw > 0 ? Math.min(Math.trunc(ticksRaw), 10000) : 1440;

    for (let i = 0; i < ticks; i++) {
      tickRoomVoteClock(roomId);
    }

    const colyseusRoom = getColyseusRoom(roomId);
    const gameMinute = colyseusRoom?.state?.gameMinute ?? 360;
    const continuationJobId = await maybeEnqueueDeliberationContinuation({
      roomId,
      gameMinute,
    });

    const state = getRoomVoteState(roomId);
    res.json({
      ok: true,
      absoluteGameMinute: state.absoluteGameMinute,
      activeDeliberation: getActiveDeliberation(roomId),
      continuationJobId,
    });
  });

  return router;
}
