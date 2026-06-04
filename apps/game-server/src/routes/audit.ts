import { Router, type Request, type Response } from "express";
import { MemoryService } from "../memory/service.js";

export function createAuditRouter(): Router {
  const router = Router();

  router.get("/:roomId/audit-log", async (req: Request, res: Response) => {
    const { roomId } = req.params;
    const limitRaw = req.query.limit;
    const limit =
      typeof limitRaw === "string" && /^\d+$/.test(limitRaw)
        ? Math.min(200, Number(limitRaw))
        : 50;

    try {
      const entries = await MemoryService.getInstance().listMutationAudits(roomId, limit);
      res.json({
        ok: true,
        entries: entries.map((row) => ({
          id: row.id,
          roomId: row.roomId,
          npcId: row.npcId,
          jobId: row.jobId,
          source: row.source,
          actionType: row.actionType,
          actionPayload: row.actionPayload,
          createdAt: row.createdAt.toISOString(),
        })),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "audit-log failed";
      res.status(500).json({ ok: false, error: message });
    }
  });

  return router;
}
