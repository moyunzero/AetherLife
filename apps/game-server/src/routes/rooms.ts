import { Router, type Request, type Response, type NextFunction } from "express";
import { safeParseGameAction } from "@aetherlife/game-actions";
import { findNpc } from "@aetherlife/shared";
import { applyGameAction, ExecutorError } from "../room/executor.js";
import { recordSuccessfulMutation } from "../audit/record.js";
import { MemoryService } from "../memory/service.js";
import { getOrCreate, reset, setState } from "../room/store.js";

function formatZodError(error: { issues: Array<{ path: (string | number)[]; message: string }> }) {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

async function applyActionsHandler(req: Request, res: Response): Promise<void> {
  const { roomId } = req.params;
  const actions = req.body?.actions;
  const actingNpcId = req.body?.actingNpcId;
  const jobId = typeof req.body?.jobId === "string" ? req.body.jobId : undefined;

  if (typeof actingNpcId !== "string" || !actingNpcId.trim()) {
    res.status(400).json({ ok: false, error: "actingNpcId required" });
    return;
  }

  const record = getOrCreate(roomId);
  if (!findNpc(record.state, actingNpcId)) {
    res.status(400).json({ ok: false, error: "unknown actingNpcId" });
    return;
  }

  if (!Array.isArray(actions)) {
    res.status(400).json({ ok: false, error: "actions must be an array" });
    return;
  }

  let current = record;
  let applied = 0;

  for (const raw of actions) {
    const parsed = safeParseGameAction(raw);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: formatZodError(parsed.error), applied });
      return;
    }
    try {
      const result = applyGameAction(current.state, parsed.data, actingNpcId);
      current = setState(roomId, result.room);
      applied += 1;
      await recordSuccessfulMutation({
        roomId,
        npcId: actingNpcId,
        action: parsed.data,
        jobId,
      });
    } catch (err) {
      const message = err instanceof ExecutorError ? err.message : "apply failed";
      res.status(400).json({ ok: false, error: message, applied });
      return;
    }
  }

  res.json({ ok: true, state: current.state, applied });
}

async function buildMemoryCounts(roomId: string, npcIds: string[]): Promise<Record<string, number>> {
  const service = MemoryService.getInstance();
  const entries = await Promise.all(
    npcIds.map(async (npcId) => [npcId, await service.getMemoryCount(roomId, npcId)] as const),
  );
  return Object.fromEntries(entries);
}

export function createRoomsRouter(): Router {
  const router = Router();

  router.get("/:roomId/state", async (req, res) => {
    const { roomId } = req.params;
    const record = getOrCreate(roomId);
    try {
      const memoryCounts = await buildMemoryCounts(
        roomId,
        record.state.npcs.map((npc) => npc.id),
      );
      res.json({ state: record.state, memoryCounts });
    } catch (err) {
      const message = err instanceof Error ? err.message : "state failed";
      res.status(500).json({ ok: false, error: message });
    }
  });

  router.post("/:roomId/reset", async (req, res) => {
    const { roomId } = req.params;
    try {
      const record = reset(roomId);
      const service = MemoryService.getInstance();
      await Promise.all(record.state.npcs.map((npc) => service.deleteAllForRoom(roomId, npc.id)));
      const memoryCounts = await buildMemoryCounts(
        roomId,
        record.state.npcs.map((npc) => npc.id),
      );
      res.json({ ok: true, state: record.state, memoryCounts });
    } catch (err) {
      const message = err instanceof Error ? err.message : "reset failed";
      res.status(500).json({ ok: false, error: message });
    }
  });

  router.post("/:roomId/apply-actions", applyActionsHandler);

  return router;
}

export function createInternalRoomsRouter(): Router {
  const router = Router();

  router.post("/:roomId/apply-actions", (req, res, next) => {
    const token = process.env.INTERNAL_WORKER_TOKEN;
    if (token) {
      const auth = req.headers.authorization;
      if (auth !== `Bearer ${token}`) {
        res.status(401).json({ ok: false, error: "unauthorized" });
        return;
      }
    }
    next();
  }, applyActionsHandler);

  return router;
}
