import { Router } from "express";
import { parseWorldHistoryStatusFilter } from "@aetherlife/shared";
import { assertScopedPlayerRequest } from "../colyseus/bridge.js";
import { playerIdFromRequest } from "../http/player-id.js";
import { getOrCreate } from "../room/store.js";
import {
  getWorldHistoryEntry,
  listWorldHistory,
} from "../world/world-history-repository.js";
import { seedWorldHistoryIfNeeded } from "../world/world-history-seed.js";

function parsePositiveInt(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const n = typeof raw === "number" ? raw : Number.parseInt(String(raw), 10);
  if (!Number.isFinite(n) || n < 1) return undefined;
  return Math.trunc(n);
}

export function createWorldHistoryRouter(): Router {
  const router = Router();

  router.get("/:roomId/world-history/:entryId", async (req, res) => {
    const { roomId, entryId } = req.params;
    const playerId = playerIdFromRequest(req);
    const scope = assertScopedPlayerRequest(req, playerId, roomId);
    if (!scope.ok) {
      res.status(scope.status).json({ ok: false, error: scope.error });
      return;
    }

    try {
      getOrCreate(roomId);
      await seedWorldHistoryIfNeeded(roomId);
      const entry = await getWorldHistoryEntry(roomId, entryId);
      if (!entry) {
        res.status(404).json({ ok: false, error: "entry not found" });
        return;
      }
      res.json({ ok: true, entry });
    } catch (err) {
      const message = err instanceof Error ? err.message : "world-history entry failed";
      res.status(500).json({ ok: false, error: message });
    }
  });

  router.get("/:roomId/world-history", async (req, res) => {
    const { roomId } = req.params;
    const playerId = playerIdFromRequest(req);
    const scope = assertScopedPlayerRequest(req, playerId, roomId);
    if (!scope.ok) {
      res.status(scope.status).json({ ok: false, error: scope.error });
      return;
    }

    const gameYear = parsePositiveInt(req.query.gameYear);
    const page = parsePositiveInt(req.query.page);
    const pageSize = parsePositiveInt(req.query.pageSize);
    const status = parseWorldHistoryStatusFilter(req.query.status);

    try {
      getOrCreate(roomId);
      await seedWorldHistoryIfNeeded(roomId);
      const payload = await listWorldHistory({
        roomId,
        gameYear,
        page,
        pageSize,
        status,
      });
      res.json({ ok: true, ...payload });
    } catch (err) {
      const message = err instanceof Error ? err.message : "world-history failed";
      res.status(500).json({ ok: false, error: message });
    }
  });

  return router;
}
