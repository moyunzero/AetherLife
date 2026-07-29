import { Router } from "express";
import { toRelationshipEdgeBandPublic } from "@aetherlife/shared";
import { assertScopedPlayerRequest } from "../colyseus/bridge.js";
import { playerIdFromRequest } from "../http/player-id.js";
import { getOrCreate } from "../room/store.js";
import { listRelationshipsForRoom } from "../world/npc-relationships-repository.js";

/**
 * Player-facing C-09b GET — band-mapped edges only (D-API-01/03, D-GRAPH-02).
 * Worker full-edge list stays on /internal/... + requireWorkerAuth.
 */
export function createNpcRelationshipsRouter(): Router {
  const router = Router();

  router.get("/:roomId/npc-relationships", async (req, res) => {
    const { roomId } = req.params;
    if (!roomId) {
      res.status(400).json({ ok: false, error: "roomId required" });
      return;
    }

    const playerId = playerIdFromRequest(req);
    const scope = assertScopedPlayerRequest(req, playerId, roomId);
    if (!scope.ok) {
      res.status(scope.status).json({ ok: false, error: scope.error });
      return;
    }

    try {
      getOrCreate(roomId);
      const edges = await listRelationshipsForRoom(roomId);
      res.json({
        ok: true,
        edges: edges.map(toRelationshipEdgeBandPublic),
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "npc-relationships list failed";
      res.status(500).json({ ok: false, error: message });
    }
  });

  return router;
}
