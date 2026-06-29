import { Router, type Request, type Response } from "express";
import { z } from "zod";
import {
  councilDeliberationSyncPayloadSchema,
  councilDeliberationVoteKindSchema,
} from "@aetherlife/shared";
import { CollectiveService } from "../collective/service.js";
import { broadcastCouncilDeliberationSync } from "../world/council-deliberation-broadcast.js";
import { listWorldHistory } from "../world/world-history-repository.js";
import { recordVoteCompleted } from "../world/world-vote-trigger.js";
import { getPendingWorldVoteJobId, clearWorldVotePending } from "../queue/world-vote.js";
import {
  applyDeliberationCheckpoint,
  getActiveDeliberation,
} from "../world/world-vote-state.js";
import { requireWorkerAuth } from "./internal.js";

const transcriptLineSchema = z.object({
  npcId: z.string().min(1),
  displayName: z.string().optional(),
  text: z.string(),
  round: z.number().int().min(0),
});

const checkpointBodySchema = z
  .object({
    jobId: z.string().min(1),
    completingJobId: z.string().min(1).optional(),
    voteKind: councilDeliberationVoteKindSchema,
    proposerIndex: z.number().int().min(0).max(11),
    proposalTitle: z.string().min(1),
    proposalBody: z.string().min(1),
    currentRound: z.number().int().min(1),
    debateRoundsMax: z.number().int().min(1).max(5),
    phase: z.enum(["proposal", "debate", "vote", "sealed"]).optional(),
    transcript: z.array(transcriptLineSchema),
  })
  .strict();

const completeBodySchema = z
  .object({
    gameMinute: z.number().int().min(0),
    voteKind: councilDeliberationVoteKindSchema,
    proposerIndex: z.number().int().min(0).max(11),
    jobId: z.string().min(1).optional(),
  })
  .strict();

export function createInternalWorldVoteRouter(): Router {
  const router = Router({ mergeParams: true });
  router.use(requireWorkerAuth);

  router.get("/:roomId/world-vote/context", async (req: Request, res: Response) => {
    const roomId = req.params.roomId;
    if (!roomId) {
      res.status(400).json({ ok: false, error: "roomId required" });
      return;
    }

    try {
      const collectiveSummaries: string[] = [];
      const seen = new Set<string>();
      const svc = CollectiveService.getInstance();
      const state = await svc.getCollectiveState(roomId, "__legacy__");
      for (const event of state.recentEvents) {
        if (seen.has(event.summary)) continue;
        seen.add(event.summary);
        collectiveSummaries.push(event.summary);
      }

      const history = await listWorldHistory({
        roomId,
        page: 1,
        pageSize: 5,
        status: "all",
      });
      const worldHistoryTail = history.entries
        .filter((e) => e.entryKind === "vote")
        .slice(0, 3)
        .map((e) => e.title);

      res.json({
        ok: true,
        collectiveSummaries: collectiveSummaries.slice(0, 20),
        speakSummaries: [],
        worldHistoryTail,
        activeDeliberation: getActiveDeliberation(roomId),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "context failed";
      res.status(500).json({ ok: false, error: message });
    }
  });

  router.get("/:roomId/world-vote/pending", async (req: Request, res: Response) => {
    const roomId = req.params.roomId;
    if (!roomId) {
      res.status(400).json({ ok: false, error: "roomId required" });
      return;
    }
    const jobId = getPendingWorldVoteJobId(roomId) ?? null;
    res.json({ ok: true, jobId });
  });

  router.post("/:roomId/world-vote/checkpoint", async (req: Request, res: Response) => {
    const roomId = req.params.roomId;
    if (!roomId) {
      res.status(400).json({ ok: false, error: "roomId required" });
      return;
    }

    const parsed = checkpointBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: parsed.error.flatten() });
      return;
    }

    const body = parsed.data;
    const deliberation = applyDeliberationCheckpoint(roomId, {
      jobId: body.jobId,
      voteKind: body.voteKind,
      proposerIndex: body.proposerIndex,
      proposalTitle: body.proposalTitle,
      proposalBody: body.proposalBody,
      currentRound: body.currentRound,
      debateRoundsMax: body.debateRoundsMax,
      phase: body.phase ?? "debate",
      transcript: body.transcript,
    });

    clearWorldVotePending(roomId, body.completingJobId);

    res.json({
      ok: true,
      activeDeliberation: deliberation,
      nextRoundAtGameMinute: deliberation.nextRoundAtGameMinute,
    });
  });

  router.post("/:roomId/council-deliberation-sync", async (req: Request, res: Response) => {
    const roomId = req.params.roomId;
    if (!roomId) {
      res.status(400).json({ ok: false, error: "roomId required" });
      return;
    }

    const parsed = councilDeliberationSyncPayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: parsed.error.flatten() });
      return;
    }

    try {
      broadcastCouncilDeliberationSync(roomId, parsed.data);
      res.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "broadcast failed";
      res.status(500).json({ ok: false, error: message });
    }
  });

  router.post("/:roomId/world-vote/complete", async (req: Request, res: Response) => {
    const roomId = req.params.roomId;
    if (!roomId) {
      res.status(400).json({ ok: false, error: "roomId required" });
      return;
    }

    const parsed = completeBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: parsed.error.flatten() });
      return;
    }

    recordVoteCompleted(roomId, {
      gameMinute: parsed.data.gameMinute,
      voteKind: parsed.data.voteKind,
      proposerIndex: parsed.data.proposerIndex,
      jobId: parsed.data.jobId,
    });
    res.json({ ok: true });
  });

  return router;
}
