import { Router, type Request, type Response } from "express";
import {
  parseChunkLore,
  toChunkLorePublic,
  type ChunkLore,
} from "@aetherlife/shared";
import { getLoreMetrics, incrementLorePostCounter } from "../metrics/lore-metrics.js";
import { requireWorkerAuth } from "./internal.js";
import {
  broadcastLoreFailed,
  broadcastLoreReady,
  broadcastLoreVoid,
  clearLorePending,
} from "../world/lore-orchestrator.js";
import { deleteChunkLore, upsertChunkLore } from "../world/lore-repository.js";

function parseCoord(raw: string): number | null {
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

export function createInternalLoreRouter(): Router {
  const router = Router({ mergeParams: true });
  router.use(requireWorkerAuth);

  router.post("/:worldId/chunks/:cx/:cy/lore", async (req: Request, res: Response) => {
    const worldId = req.params.worldId;
    const cx = parseCoord(req.params.cx);
    const cy = parseCoord(req.params.cy);
    if (!worldId || cx === null || cy === null) {
      res.status(400).json({ ok: false, error: "invalid worldId or chunk coords" });
      return;
    }

    const failed = req.body?.failed === true;
    const mapRoomId =
      typeof req.body?.mapRoomId === "string" ? req.body.mapRoomId : worldId;

    if (failed) {
      await clearLorePending(worldId, cx, cy);
      broadcastLoreFailed(mapRoomId, cx, cy);
      res.json({ ok: true, status: "failed" });
      return;
    }

    const dominantBiome =
      typeof req.body?.dominantBiome === "string" ? req.body.dominantBiome : undefined;
    const modelTier = req.body?.modelTier === "T1" ? "T1" : "T0";
    const loreRaw = req.body?.lore;

    let lore: ChunkLore;
    try {
      lore = parseChunkLore(loreRaw);
    } catch {
      res.status(400).json({ ok: false, error: "invalid lore schema" });
      return;
    }

    if (dominantBiome && lore.proceduralBiome !== dominantBiome) {
      res.status(400).json({ ok: false, error: "proceduralBiome mismatch" });
      return;
    }

    try {
      await upsertChunkLore(worldId, cx, cy, lore, modelTier);
    } catch (err) {
      const message = err instanceof Error ? err.message : "upsert failed";
      await clearLorePending(worldId, cx, cy);
      broadcastLoreVoid(mapRoomId, cx, cy);
      res.status(400).json({ ok: false, error: message });
      return;
    }

    await clearLorePending(worldId, cx, cy);
    incrementLorePostCounter();
    broadcastLoreReady(mapRoomId, cx, cy, lore);
    res.json({ ok: true, lore: toChunkLorePublic(lore) });
  });

  router.delete("/:worldId/chunks/:cx/:cy/lore", async (req: Request, res: Response) => {
    const worldId = req.params.worldId;
    const cx = parseCoord(req.params.cx);
    const cy = parseCoord(req.params.cy);
    if (!worldId || cx === null || cy === null) {
      res.status(400).json({ ok: false, error: "invalid worldId or chunk coords" });
      return;
    }
    await deleteChunkLore(worldId, cx, cy);
    await clearLorePending(worldId, cx, cy);
    res.json({ ok: true });
  });

  return router;
}

export function createInternalLoreMetricsRouter(): Router {
  const router = Router();
  router.get("/lore", requireWorkerAuth, (_req, res) => {
    res.json({ ok: true, ...getLoreMetrics() });
  });
  return router;
}
