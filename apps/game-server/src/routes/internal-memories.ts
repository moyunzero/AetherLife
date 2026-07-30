import { Router, type Request, type Response } from "express";
import { COUNCIL_MEMORY_PLAYER_ID, MAX_PLAYER_MESSAGE_LEN } from "@aetherlife/shared";
import { requireWorkerAuth } from "./internal.js";
import { playerIdFromRequest } from "../http/player-id.js";
import { MemoryService } from "../memory/service.js";
import {
  getCachedMemoryContext,
  invalidateMemoryContextForPlayer,
  memoryContextCacheKey,
  setCachedMemoryContext,
} from "../memory/memoryContextCache.js";
import { logInternalLatency } from "../observability/internalLatency.js";

function playerIdFromInternal(req: Request): string {
  const body = req.body as { playerId?: unknown } | undefined;
  const queryPlayerId =
    typeof req.query.playerId === "string" ? req.query.playerId : undefined;
  const bodyWithQuery =
    queryPlayerId && body?.playerId == null
      ? { ...body, playerId: queryPlayerId }
      : body;
  return playerIdFromRequest(req, bodyWithQuery);
}

export function createInternalMemoriesRouter(): Router {
  const router = Router({ mergeParams: true });
  router.use(requireWorkerAuth);

  router.post("/:roomId/memories", async (req: Request, res: Response) => {
    const { roomId } = req.params;
    const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    const npcId = typeof req.body?.npcId === "string" ? req.body.npcId : "npc-1";
    const playerId = playerIdFromInternal(req);
    const importance =
      typeof req.body?.importance === "number" ? req.body.importance : undefined;
    const role = req.body?.role === "player" ? "player" : "npc";
    const skipEmbed = req.body?.skipEmbed === true;

    if (!text) {
      res.status(400).json({ ok: false, error: "text required" });
      return;
    }
    if (text.length > MAX_PLAYER_MESSAGE_LEN) {
      res.status(400).json({ ok: false, error: "text too long" });
      return;
    }

    try {
      const service = MemoryService.getInstance();
      if (role === "player") {
        await service.appendPlayerMemory(roomId, text, npcId, playerId, importance);
      } else {
        await service.appendNpcMemory(roomId, text, npcId, playerId, importance, { skipEmbed });
      }
      invalidateMemoryContextForPlayer(roomId, playerId, npcId);
      res.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "append failed";
      res.status(500).json({ ok: false, error: message });
    }
  });

  router.post("/:roomId/council-vote-memories", async (req: Request, res: Response) => {
    const { roomId } = req.params;
    const ballots = Array.isArray(req.body?.ballots) ? req.body.ballots : [];

    const parsed = ballots.map((ballot: unknown) => {
      if (!ballot || typeof ballot !== "object") return null;
      const row = ballot as Record<string, unknown>;
      const npcId = typeof row.npcId === "string" ? row.npcId : "";
      const vote = typeof row.vote === "string" ? row.vote : "";
      const reasonZh = typeof row.reasonZh === "string" ? row.reasonZh.trim() : "";
      if (!npcId || !vote || !reasonZh) return null;
      return { npcId, vote, reasonZh };
    });

    if (parsed.some((row) => row === null)) {
      res.status(400).json({ ok: false, error: "invalid ballot payload" });
      return;
    }

    const normalized = parsed as { npcId: string; vote: string; reasonZh: string }[];
    const uniqueNpcIds = new Set(normalized.map((row) => row.npcId));
    if (uniqueNpcIds.size !== normalized.length) {
      res.status(400).json({ ok: false, error: "duplicate ballot npcId" });
      return;
    }

    if (normalized.length === 0) {
      res.status(400).json({ ok: false, error: "ballots required" });
      return;
    }

    try {
      const service = MemoryService.getInstance();
      const result = await service.appendCouncilVoteMemories(roomId, normalized);
      for (const ballot of normalized) {
        invalidateMemoryContextForPlayer(roomId, COUNCIL_MEMORY_PLAYER_ID, ballot.npcId);
      }
      res.json({ ok: true, count: result.count });
    } catch (err) {
      const message = err instanceof Error ? err.message : "council vote memories failed";
      res.status(500).json({ ok: false, error: message });
    }
  });

  router.get("/:roomId/memory-context", async (req: Request, res: Response) => {
    const { roomId } = req.params;
    const playerMessage =
      typeof req.query.playerMessage === "string" ? req.query.playerMessage : "";
    const npcId = typeof req.query.npcId === "string" ? req.query.npcId : "npc-1";
    const playerId = playerIdFromInternal(req);

    if (!playerMessage.trim()) {
      res.status(400).json({ ok: false, error: "playerMessage query required" });
      return;
    }

    const skipEmbed = req.query.skipEmbed === "1" || req.query.skipEmbed === "true";
    const speakHotPath = req.header("x-speak-hot-path") === "1";

    const cacheKey = memoryContextCacheKey(roomId, playerId, npcId, playerMessage, skipEmbed);
    const started = Date.now();
    const cached = getCachedMemoryContext(cacheKey);
    if (cached) {
      logInternalLatency({
        route: "memory-context",
        ms: Date.now() - started,
        roomId,
        cacheHit: true,
        skipEmbed,
      });
      res.json({ ok: true, ...cached });
      return;
    }

    try {
      const service = MemoryService.getInstance();
      const context =
        playerId === COUNCIL_MEMORY_PLAYER_ID
          ? await service.buildCouncilMemoryContext(roomId, npcId, playerMessage, {
              skipEmbed,
              embedPriority: speakHotPath,
            })
          : await service.buildMemoryContext(roomId, playerMessage, npcId, playerId, {
              skipEmbed,
              embedPriority: speakHotPath,
            });
      setCachedMemoryContext(cacheKey, context);
      logInternalLatency({
        route: "memory-context",
        ms: Date.now() - started,
        roomId,
        cacheHit: false,
        skipEmbed,
      });
      res.json({ ok: true, ...context });
    } catch (err) {
      const message = err instanceof Error ? err.message : "context failed";
      res.status(500).json({ ok: false, error: message });
    }
  });

  router.get("/:roomId/recent-memories", async (req: Request, res: Response) => {
    const { roomId } = req.params;
    const npcId = typeof req.query.npcId === "string" ? req.query.npcId : "npc-1";
    const playerId = playerIdFromInternal(req);
    const limit = Math.min(
      50,
      Math.max(1, Number.parseInt(String(req.query.limit ?? "5"), 10) || 5),
    );

    try {
      const memories = await MemoryService.getInstance().getRecentUnsummarized(
        roomId,
        limit,
        npcId,
        playerId,
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
    const playerId = playerIdFromInternal(req);
    const limit = Math.min(
      100,
      Math.max(1, Number.parseInt(String(req.query.limit ?? "50"), 10) || 50),
    );

    try {
      const memories = await MemoryService.getInstance().getOldestUnsummarizedBatch(
        roomId,
        limit,
        npcId,
        playerId,
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
    const playerId = playerIdFromInternal(req);

    if (!text) {
      res.status(400).json({ ok: false, error: "text required" });
      return;
    }

    const semantic: {
      mood?: string;
      beliefs?: string[];
      summary?: string;
    } = {};
    if (typeof req.body?.mood === "string") {
      semantic.mood = req.body.mood;
    }
    if (Array.isArray(req.body?.beliefs)) {
      semantic.beliefs = req.body.beliefs.filter((b: unknown): b is string => typeof b === "string");
    }
    if (typeof req.body?.summary === "string") {
      semantic.summary = req.body.summary;
    }
    const hasSemantic = Object.keys(semantic).length > 0;

    try {
      await MemoryService.getInstance().storeReflection(
        roomId,
        text,
        npcId,
        playerId,
        hasSemantic ? semantic : undefined,
      );
      invalidateMemoryContextForPlayer(roomId, playerId, npcId);
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
    const playerId = playerIdFromInternal(req);
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
        playerId,
      );
      invalidateMemoryContextForPlayer(roomId, playerId, npcId);
      res.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "summarize failed";
      res.status(500).json({ ok: false, error: message });
    }
  });

  router.delete("/:roomId/memories", async (req: Request, res: Response) => {
    const { roomId } = req.params;
    const npcId = typeof req.query.npcId === "string" ? req.query.npcId : undefined;
    const playerId = playerIdFromInternal(req);

    try {
      const service = MemoryService.getInstance();
      if (npcId) {
        await service.deleteForPlayerNpc(roomId, playerId, npcId);
        invalidateMemoryContextForPlayer(roomId, playerId, npcId);
      } else {
        await service.deleteForPlayer(roomId, playerId);
        invalidateMemoryContextForPlayer(roomId, playerId);
      }
      res.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "delete failed";
      res.status(500).json({ ok: false, error: message });
    }
  });

  return router;
}
