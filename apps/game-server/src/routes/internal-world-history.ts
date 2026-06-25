import { Router, type Request, type Response } from "express";
import { z } from "zod";
import {
  chronicleGameYearFromMinute,
  parseWorldHistoryMinutes,
  validateWorldHistoryStrings,
  worldHistoryMinutesSchema,
} from "@aetherlife/shared";
import { getContentBlockedResponse } from "../colyseus/npc-chat.js";
import { broadcastWorldHistorySync } from "../world/world-history-broadcast.js";
import { insertWorldHistoryEntry } from "../world/world-history-repository.js";
import { requireWorkerAuth } from "./internal.js";

const writebackBodySchema = z
  .object({
    entryKind: z.enum(["genesis", "vote"]),
    status: z.enum(["accepted", "rejected"]),
    title: z.string().min(1).max(120),
    proposal: z.string().min(1).max(8000),
    proposerDisplayName: z.string().min(1).max(80),
    proposerNpcId: z.string().min(1).optional(),
    minutes: worldHistoryMinutesSchema,
    gameMinuteSnapshot: z.number().int().min(0),
    yesCount: z.number().int().min(0).max(12).optional().nullable(),
    noCount: z.number().int().min(0).max(12).optional().nullable(),
    voteEpoch: z.string().min(1).optional().nullable(),
    mapRoomId: z.string().min(1).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.entryKind === "vote" && !data.voteEpoch) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "voteEpoch required for vote entries",
        path: ["voteEpoch"],
      });
    }
  });

export function createInternalWorldHistoryRouter(): Router {
  const router = Router();
  router.use(requireWorkerAuth);

  router.post("/:roomId/world-history", async (req: Request, res: Response) => {
    const roomId = req.params.roomId;
    if (!roomId) {
      res.status(400).json({ ok: false, error: "roomId required" });
      return;
    }

    const parsed = writebackBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: parsed.error.flatten() });
      return;
    }

    const data = parsed.data;
    const blockedTitle = getContentBlockedResponse(data.title);
    if (blockedTitle) {
      res.status(400).json({ ok: false, ...blockedTitle, error: blockedTitle.message });
      return;
    }
    const blockedProposal = getContentBlockedResponse(data.proposal);
    if (blockedProposal) {
      res.status(400).json({ ok: false, ...blockedProposal, error: blockedProposal.message });
      return;
    }

    const stringBlock = validateWorldHistoryStrings({
      title: data.title,
      proposal: data.proposal,
    });
    if (stringBlock) {
      res.status(400).json({ ok: false, error: `content blocked: ${stringBlock}` });
      return;
    }

    let minutes;
    try {
      minutes = parseWorldHistoryMinutes(data.minutes);
    } catch {
      res.status(400).json({ ok: false, error: "invalid minutes schema" });
      return;
    }

    const gameYear = chronicleGameYearFromMinute(data.gameMinuteSnapshot);
    const mapRoomId = data.mapRoomId ?? roomId;
    if (mapRoomId !== roomId) {
      res.status(400).json({ ok: false, error: "mapRoomId must match roomId" });
      return;
    }

    try {
      const entry = await insertWorldHistoryEntry({
        roomId,
        entryKind: data.entryKind,
        status: data.status,
        title: data.title,
        proposal: data.proposal,
        proposerDisplayName: data.proposerDisplayName,
        proposerNpcId: data.proposerNpcId ?? null,
        yesCount: data.yesCount ?? null,
        noCount: data.noCount ?? null,
        minutes,
        gameYear,
        gameMinuteSnapshot: data.gameMinuteSnapshot,
        voteEpoch: data.voteEpoch ?? null,
      });
      try {
        broadcastWorldHistorySync(roomId, entry);
      } catch (broadcastErr) {
        console.error(
          "[world-history] broadcastWorldHistorySync failed after insert",
          broadcastErr,
        );
      }
      res.json({ ok: true, entry });
    } catch (err) {
      const message = err instanceof Error ? err.message : "insert failed";
      if (message.includes("content blocked")) {
        res.status(400).json({ ok: false, error: message });
        return;
      }
      res.status(500).json({ ok: false, error: message });
    }
  });

  return router;
}
