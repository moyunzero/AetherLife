import { Router } from "express";
import { findNpc } from "@aetherlife/shared";
import { assertScopedPlayerRequest } from "../colyseus/bridge.js";
import { CollectiveService } from "../collective/service.js";
import { playerIdFromRequest } from "../http/player-id.js";
import { getOrCreate } from "../room/store.js";

export function createCollectiveStateRouter(): Router {
  const router = Router();

  router.get("/:roomId/collective-state", async (req, res) => {
    // D-BELIEF-11: payload from getCollectiveState — band/reputation only; no mood/beliefs/summary.
    const { roomId } = req.params;
    const npcId = typeof req.query.npcId === "string" ? req.query.npcId : undefined;

    if (npcId) {
      const record = getOrCreate(roomId);
      if (!findNpc(record.state, npcId)) {
        res.status(404).json({ ok: false, error: "npc not found" });
        return;
      }
    }

    const playerId = playerIdFromRequest(req);
    const scope = assertScopedPlayerRequest(req, playerId, roomId);
    if (!scope.ok) {
      res.status(scope.status).json({ ok: false, error: scope.error });
      return;
    }

    try {
      const payload = await CollectiveService.getInstance().getCollectiveState(
        roomId,
        playerId,
        npcId,
      );
      res.json({ ok: true, ...payload });
    } catch (err) {
      const message = err instanceof Error ? err.message : "collective-state failed";
      res.status(500).json({ ok: false, error: message });
    }
  });

  return router;
}
