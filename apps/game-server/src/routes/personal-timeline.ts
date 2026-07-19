import { Router } from "express";
import { assertScopedPlayerRequest } from "../colyseus/bridge.js";
import { playerIdFromRequest } from "../http/player-id.js";
import { getOrCreate } from "../room/store.js";
import { listPersonalTimelineForNpc } from "../world/personal-timeline-repository.js";

function parseNonNegInt(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const n = typeof raw === "number" ? raw : Number.parseInt(String(raw), 10);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.trunc(n);
}

export function createPersonalTimelineRouter(): Router {
  const router = Router();

  router.get("/:roomId/npcs/:npcId/personal-timeline", async (req, res) => {
    const { roomId, npcId } = req.params;
    if (!roomId || !npcId) {
      res.status(400).json({ ok: false, error: "roomId and npcId required" });
      return;
    }

    const playerId = playerIdFromRequest(req);
    const scope = assertScopedPlayerRequest(req, playerId, roomId);
    if (!scope.ok) {
      res.status(scope.status).json({ ok: false, error: scope.error });
      return;
    }

    const limit = parseNonNegInt(req.query.limit);
    const offset = parseNonNegInt(req.query.offset);

    try {
      getOrCreate(roomId);
      const payload = await listPersonalTimelineForNpc({
        roomId,
        npcId,
        limit,
        offset,
      });
      res.json({ ok: true, ...payload });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "personal-timeline list failed";
      res.status(500).json({ ok: false, error: message });
    }
  });

  return router;
}
