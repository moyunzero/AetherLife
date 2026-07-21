import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { relationshipDeltaInputSchema } from "@aetherlife/shared";
import {
  applyRelationshipDeltas,
  ensureRelationshipEdgeEmbedding,
  listRelationshipsForRoom,
  searchSimilarEdges,
} from "../world/npc-relationships-repository.js";
import { embedText } from "../memory/embed.js";
import { broadcastRelationshipSync } from "../world/relationship-broadcast.js";
import { getRoomVoteState } from "../world/world-vote-state.js";
import { requireWorkerAuth } from "./internal.js";

const applyDeltasBodySchema = z
  .object({
    deltas: z.array(relationshipDeltaInputSchema).min(1).max(66),
    voteEpoch: z.string().min(1).optional(),
  })
  .strict();

const ensureEmbeddingBodySchema = z
  .object({
    npcAId: z.string().min(1),
    npcBId: z.string().min(1),
  })
  .strict();

const searchSimilarBodySchema = z
  .object({
    query: z.string().min(1),
    activeNpcId: z.string().min(1).optional(),
    k: z.number().int().min(1).max(10).optional(),
  })
  .strict();

function safeBroadcastRelationshipSync(roomId: string): void {
  try {
    broadcastRelationshipSync(roomId, { hasUpdate: true });
  } catch (err) {
    console.error("[npc-relationships] broadcastRelationshipSync failed", err);
  }
}

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
        // Stamp last-interact with the room clock so monthly idle decay
        // measures from the real interaction, not abs=0 (Codex CR PR#22).
        const result = await applyRelationshipDeltas({
          roomId,
          deltas: parsed.data.deltas,
          voteEpoch: parsed.data.voteEpoch,
          absoluteGameMinute: getRoomVoteState(roomId).absoluteGameMinute,
        });
        if (result.linkedEdges.length > 0) {
          safeBroadcastRelationshipSync(roomId);
        }
        res.json({ ok: true, linkedEdges: result.linkedEdges });
      } catch (err) {
        const message = err instanceof Error ? err.message : "apply-deltas failed";
        res.status(500).json({ ok: false, error: message });
      }
    },
  );

  router.post(
    "/:roomId/npc-relationships/ensure-embedding",
    async (req: Request, res: Response) => {
      const roomId = req.params.roomId;
      if (!roomId) {
        res.status(400).json({ ok: false, error: "roomId required" });
        return;
      }
      const parsed = ensureEmbeddingBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ ok: false, error: parsed.error.flatten() });
        return;
      }
      try {
        const embedded = await ensureRelationshipEdgeEmbedding(
          roomId,
          parsed.data.npcAId,
          parsed.data.npcBId,
        );
        res.json({ ok: true, embedded });
      } catch (err) {
        const message = err instanceof Error ? err.message : "ensure-embedding failed";
        res.status(500).json({ ok: false, error: message });
      }
    },
  );

  router.post(
    "/:roomId/npc-relationships/search-similar",
    async (req: Request, res: Response) => {
      const roomId = req.params.roomId;
      if (!roomId) {
        res.status(400).json({ ok: false, error: "roomId required" });
        return;
      }
      const parsed = searchSimilarBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ ok: false, error: parsed.error.flatten() });
        return;
      }
      try {
        const queryEmbedding = await embedText(parsed.data.query);
        const edges = await searchSimilarEdges({
          roomId,
          queryEmbedding,
          activeNpcId: parsed.data.activeNpcId,
          k: parsed.data.k ?? 5,
        });
        res.json({ ok: true, edges });
      } catch (err) {
        const message = err instanceof Error ? err.message : "search-similar failed";
        res.status(500).json({ ok: false, error: message });
      }
    },
  );

  return router;
}
