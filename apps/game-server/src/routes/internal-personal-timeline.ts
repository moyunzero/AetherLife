import { Router, type Request, type Response } from "express";
import { z } from "zod";
import {
  PERSONAL_TIMELINE_TAGS,
  validatePersonalTimelineStrings,
} from "@aetherlife/shared";
import { getContentBlockedResponse } from "../colyseus/npc-chat.js";
import { getOrCreate } from "../room/store.js";
import { insertPersonalTimelineEntry } from "../world/personal-timeline-repository.js";
import { requireWorkerAuth } from "./internal.js";

const writebackBodySchema = z.object({
  npcId: z.string().min(1).max(64),
  calendarLabel: z.string().min(1).max(80),
  aetherEpochMinute: z.number().int().min(0),
  tag: z.enum(PERSONAL_TIMELINE_TAGS),
  body: z.string().min(1).max(8000),
  eventAnchorId: z.string().min(1).max(128).optional().nullable(),
  factualSummary: z.string().min(1).max(2000).optional().nullable(),
  source: z.enum(["seed", "llm_scheduled", "llm_event", "llm_reflection"]),
  proposalEligible: z.boolean().optional(),
});

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

  return router;
}
