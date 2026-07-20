import { Router, type Request, type Response } from "express";
import { z } from "zod";
import {
  LIFETIME_EPOCH_MINUTE_BASE,
  PERSONAL_TIMELINE_TAGS,
  validatePersonalTimelineStrings,
} from "@aetherlife/shared";
import { getContentBlockedResponse } from "../colyseus/npc-chat.js";
import { getOrCreate } from "../room/store.js";
import { broadcastPersonalTimelineSync } from "../world/personal-timeline-broadcast.js";
import {
  insertPersonalTimelineEntry,
  updatePersonalTimelineBody,
} from "../world/personal-timeline-repository.js";
import { requireWorkerAuth } from "./internal.js";

const writebackBodySchema = z.object({
  npcId: z.string().min(1).max(64),
  calendarLabel: z.string().min(1).max(80),
  // C-11: lifetime/pre-arrival stamps may be negative (LIFETIME_EPOCH_MINUTE_BASE).
  aetherEpochMinute: z
    .number()
    .int()
    .min(LIFETIME_EPOCH_MINUTE_BASE)
    .max(1_000_000_000),
  tag: z.enum(PERSONAL_TIMELINE_TAGS),
  body: z.string().min(1).max(8000),
  eventAnchorId: z.string().min(1).max(128).optional().nullable(),
  factualSummary: z.string().min(1).max(2000).optional().nullable(),
  source: z.enum(["seed", "llm_scheduled", "llm_event", "llm_reflection"]),
  proposalEligible: z.boolean().optional(),
});

const polishBodySchema = z.object({
  body: z.string().min(1).max(8000),
});

function emitTimelineHint(
  roomId: string,
  entry: { npcId: string; seq: number },
): void {
  try {
    broadcastPersonalTimelineSync(roomId, {
      npcId: entry.npcId,
      hasUpdate: true,
      latestSeq: entry.seq,
    });
  } catch (err) {
    console.error(
      "[personal-timeline] broadcastPersonalTimelineSync failed",
      err,
    );
  }
}

export function createInternalPersonalTimelineRouter(): Router {
  const router = Router();
  router.use(requireWorkerAuth);

  router.post("/:roomId/personal-timeline", async (req: Request, res: Response) => {
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
    const blockedBody = getContentBlockedResponse(data.body);
    if (blockedBody) {
      res.status(400).json({ ok: false, ...blockedBody, error: blockedBody.message });
      return;
    }
    if (data.factualSummary) {
      const blockedSummary = getContentBlockedResponse(data.factualSummary);
      if (blockedSummary) {
        res
          .status(400)
          .json({ ok: false, ...blockedSummary, error: blockedSummary.message });
        return;
      }
    }

    const stringBlock = validatePersonalTimelineStrings({
      body: data.body,
      factualSummary: data.factualSummary,
    });
    if (stringBlock) {
      res.status(400).json({ ok: false, error: `content blocked: ${stringBlock}` });
      return;
    }

    try {
      getOrCreate(roomId);
      const entry = await insertPersonalTimelineEntry({
        roomId,
        npcId: data.npcId,
        calendarLabel: data.calendarLabel,
        aetherEpochMinute: data.aetherEpochMinute,
        tag: data.tag,
        body: data.body,
        eventAnchorId: data.eventAnchorId ?? null,
        factualSummary: data.factualSummary ?? null,
        proposalEligible: data.proposalEligible,
        source: data.source,
      });
      emitTimelineHint(roomId, entry);
      res.json({ ok: true, entry });
    } catch (err) {
      const message = err instanceof Error ? err.message : "insert failed";
      if (message.includes("content blocked") || message.includes("invalid personal")) {
        res.status(400).json({ ok: false, error: message });
        return;
      }
      res.status(500).json({ ok: false, error: message });
    }
  });

  /** D-SEED-04 polish replace — body only; hint broadcast after success. */
  router.patch(
    "/:roomId/personal-timeline/:entryId",
    async (req: Request, res: Response) => {
      const roomId = req.params.roomId;
      const entryId = req.params.entryId;
      if (!roomId || !entryId) {
        res.status(400).json({ ok: false, error: "roomId and entryId required" });
        return;
      }

      const parsed = polishBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ ok: false, error: parsed.error.flatten() });
        return;
      }

      const blockedBody = getContentBlockedResponse(parsed.data.body);
      if (blockedBody) {
        res
          .status(400)
          .json({ ok: false, ...blockedBody, error: blockedBody.message });
        return;
      }
      const stringBlock = validatePersonalTimelineStrings({
        body: parsed.data.body,
      });
      if (stringBlock) {
        res.status(400).json({ ok: false, error: `content blocked: ${stringBlock}` });
        return;
      }

      try {
        getOrCreate(roomId);
        const entry = await updatePersonalTimelineBody({
          roomId,
          entryId,
          body: parsed.data.body,
        });
        if (!entry) {
          res.status(404).json({ ok: false, error: "entry not found" });
          return;
        }
        emitTimelineHint(roomId, entry);
        res.json({ ok: true, entry });
      } catch (err) {
        const message = err instanceof Error ? err.message : "update failed";
        if (message.includes("content blocked")) {
          res.status(400).json({ ok: false, error: message });
          return;
        }
        res.status(500).json({ ok: false, error: message });
      }
    },
  );

  return router;
}
