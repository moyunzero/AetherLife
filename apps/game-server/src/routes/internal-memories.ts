import { Router, type Request, type Response } from "express";
import { requireWorkerAuth } from "./internal.js";
import { MemoryService } from "../memory/service.js";

export function createInternalMemoriesRouter(): Router {
  const router = Router({ mergeParams: true });
  router.use(requireWorkerAuth);

  router.post("/:roomId/memories", async (req: Request, res: Response) => {
    const { roomId } = req.params;
    const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    const npcId = typeof req.body?.npcId === "string" ? req.body.npcId : "npc-1";
    const importance =
      typeof req.body?.importance === "number" ? req.body.importance : undefined;

    if (!text) {
      res.status(400).json({ ok: false, error: "text required" });
      return;
    }

    try {
      const service = MemoryService.getInstance();
      await service.appendNpcMemory(roomId, text, npcId, importance);
      res.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "append failed";
      res.status(500).json({ ok: false, error: message });
    }
  });

  router.get("/:roomId/memory-context", async (req: Request, res: Response) => {
    const { roomId } = req.params;
    const playerMessage =
      typeof req.query.playerMessage === "string" ? req.query.playerMessage : "";
    const npcId = typeof req.query.npcId === "string" ? req.query.npcId : "npc-1";

    if (!playerMessage.trim()) {
      res.status(400).json({ ok: false, error: "playerMessage query required" });
      return;
    }

    try {
      const service = MemoryService.getInstance();
      const context = await service.buildMemoryContext(roomId, playerMessage, npcId);
      res.json({ ok: true, ...context });
    } catch (err) {
      const message = err instanceof Error ? err.message : "context failed";
      res.status(500).json({ ok: false, error: message });
    }
  });

  router.get("/:roomId/recent-memories", async (req: Request, res: Response) => {
    const { roomId } = req.params;
    const npcId = typeof req.query.npcId === "string" ? req.query.npcId : "npc-1";
    const limit = Math.min(
      50,
      Math.max(1, Number.parseInt(String(req.query.limit ?? "5"), 10) || 5),
    );

    try {
      const memories = await MemoryService.getInstance().getRecentUnsummarized(
        roomId,
        limit,
        npcId,
      );
      res.json({ ok: true, memories });
    } catch (err) {
      const message = err instanceof Error ? err.message : "recent failed";
      res.status(500).json({ ok: false, error: message });
    }
  });

  router.get("/:roomId/oldest-memories", async (req: Request, res: Response) => {
    const { roomId } = req.params;
    const npcId = typeof req.query.npcId === "string" ? req.query.npcId : "npc-1";
    const limit = Math.min(
      100,
      Math.max(1, Number.parseInt(String(req.query.limit ?? "50"), 10) || 50),
    );

    try {
      const memories = await MemoryService.getInstance().getOldestUnsummarizedBatch(
        roomId,
        limit,
        npcId,
      );
      res.json({ ok: true, memories });
    } catch (err) {
      const message = err instanceof Error ? err.message : "oldest failed";
      res.status(500).json({ ok: false, error: message });
    }
  });

  router.post("/:roomId/reflect", async (req: Request, res: Response) => {
    const { roomId } = req.params;
    const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    const npcId = typeof req.body?.npcId === "string" ? req.body.npcId : "npc-1";

    if (!text) {
      res.status(400).json({ ok: false, error: "text required" });
      return;
    }

    try {
      await MemoryService.getInstance().storeReflection(roomId, text, npcId);
      res.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "reflect failed";
      res.status(500).json({ ok: false, error: message });
    }
  });

  router.post("/:roomId/summarize-bulk", async (req: Request, res: Response) => {
    const { roomId } = req.params;
    const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    const npcId = typeof req.body?.npcId === "string" ? req.body.npcId : "npc-1";
    const markIds = Array.isArray(req.body?.markIds)
      ? req.body.markIds.filter((id: unknown) => typeof id === "string")
      : [];
    const sourceCount =
      typeof req.body?.sourceCount === "number" ? req.body.sourceCount : markIds.length;

    if (!text || markIds.length === 0) {
      res.status(400).json({ ok: false, error: "text and markIds required" });
      return;
    }

    try {
      await MemoryService.getInstance().storeBulkSummary(
        roomId,
        text,
        sourceCount,
        markIds,
        npcId,
      );
      res.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "summarize failed";
      res.status(500).json({ ok: false, error: message });
    }
  });

  router.delete("/:roomId/memories", async (req: Request, res: Response) => {
    const { roomId } = req.params;
    const npcId = typeof req.query.npcId === "string" ? req.query.npcId : "npc-1";

    try {
      await MemoryService.getInstance().deleteAllForRoom(roomId, npcId);
      res.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "delete failed";
      res.status(500).json({ ok: false, error: message });
    }
  });

  return router;
}
