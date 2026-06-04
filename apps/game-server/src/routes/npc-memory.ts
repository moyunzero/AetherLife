import { Router } from "express";
import { findNpc } from "@aetherlife/shared";
import { MemoryService } from "../memory/service.js";
import { getOrCreate } from "../room/store.js";

export function createNpcMemoryRouter(): Router {
  const router = Router();

  router.get("/:roomId/npc-memory/:npcId", async (req, res) => {
    const { roomId, npcId } = req.params;
    const record = getOrCreate(roomId);
    if (!findNpc(record.state, npcId)) {
      res.status(404).json({ ok: false, error: "npc not found" });
      return;
    }

    try {
      const debug = await MemoryService.getInstance().getNpcMemoryDebug(roomId, npcId);
      res.json(debug);
    } catch (err) {
      const message = err instanceof Error ? err.message : "npc memory failed";
      res.status(500).json({ ok: false, error: message });
    }
  });

  return router;
}
