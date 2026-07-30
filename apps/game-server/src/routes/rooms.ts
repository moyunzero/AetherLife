import { Router, type Request, type Response, type NextFunction } from "express";
import { safeParseGameAction, type GameAction } from "@aetherlife/game-actions";
import {
  findNpc,
  HOME_CHUNK_LORE,
  chunkOf,
  normalizePlayerId,
  PLAYER_ID_HEADER,
  toChunkLorePublic,
  type CollectivePosition,
} from "@aetherlife/shared";
import { applyGameAction, ExecutorError } from "../room/executor.js";
import { recordSuccessfulMutation } from "../audit/record.js";
import { MemoryService } from "../memory/service.js";
import {
  clearActionTrackersForPlayer,
  detectRoomCollaborateTransfer,
  detectRoomCompeteObject,
  recordRoomNpcTransfer,
  recordRoomObjectInteract,
} from "../collective/action-tracker.js";
import { attitudeGateResponse, isActionBlockedByGate } from "../collective/gate.js";
import { moveIntentTracker } from "../collective/move-intent-tracker.js";
import { CollectiveService } from "../collective/service.js";
import {
  assertScopedPlayerRequest,
  collectPlayerCells,
  findPlayerCellByPlayerId,
  resetColyseusFromMap,
  roomStateForInitiator,
} from "../colyseus/bridge.js";
import { getColyseusRoom } from "../colyseus/room-registry.js";
import { playerIdFromRequest } from "../http/player-id.js";
import { getOrCreate, reset, setState } from "../room/store.js";
import { getChunkLoader } from "../world/chunk-loader.js";
import { getChunkLore } from "../world/lore-repository.js";
import { getChunkLoreCached } from "../world/lore-chunk-cache.js";
import { getRoomVoteState } from "../world/world-vote-state.js";
import { logInternalLatency } from "../observability/internalLatency.js";
import {
  appendCompletedTurn,
  clearDialogueForPlayer,
  evictDialogueMapForRoom,
  listDialogueTurnsForUat,
} from "../npc/dialogue-session.js";
import {
  getCachedWorkerState,
  setCachedWorkerState,
  workerStateCacheKey,
} from "../colyseus/workerStateCache.js";
import { requireWorkerAuth } from "./internal.js";

function formatZodError(error: { issues: Array<{ path: (string | number)[]; message: string }> }) {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

function npcPositionsForRoom(roomId: string): Map<string, CollectivePosition> {
  const record = getOrCreate(roomId);
  return new Map(record.state.npcs.map((n) => [n.id, { x: n.x, y: n.y }]));
}

async function recordActionCollectiveRules(
  roomId: string,
  actingNpcId: string,
  initiatorPlayerId: string | undefined,
  action: GameAction,
): Promise<void> {
  if (!initiatorPlayerId) return;

  const svc = CollectiveService.getInstance();
  const windowMs = svc.windowMs();
  const now = Date.now();
  const npcPositions = npcPositionsForRoom(roomId);

  if (action.type === "move") {
    const contradict = moveIntentTracker.detectContradict(
      roomId,
      actingNpcId,
      initiatorPlayerId,
      action.x,
      action.y,
      now,
      windowMs,
    );
    if (contradict) {
      await svc.recordRuleEvent({
        roomId,
        npcId: actingNpcId,
        kind: "contradict",
        summary: "多名玩家对同一 NPC 下达冲突移动",
        playerIds: [initiatorPlayerId, contradict.otherPlayerId],
        npcPositions,
      });
    }
    moveIntentTracker.record(roomId, actingNpcId, initiatorPlayerId, action.x, action.y, now);
    return;
  }

  if (action.type === "interact") {
    const rule = detectRoomCompeteObject(
      roomId,
      action.objectId,
      initiatorPlayerId,
      now,
      windowMs,
    );
    recordRoomObjectInteract(roomId, action.objectId, initiatorPlayerId, now);
    if (rule) {
      await svc.recordRuleEvent({
        roomId,
        npcId: actingNpcId,
        kind: rule.kind,
        summary: rule.summary,
        playerIds: rule.playerIds,
        npcPositions,
      });
    }
    return;
  }

  if (action.type === "transfer") {
    const rule = detectRoomCollaborateTransfer(
      roomId,
      action.toNpcId,
      initiatorPlayerId,
      now,
      windowMs,
    );
    recordRoomNpcTransfer(roomId, action.toNpcId, initiatorPlayerId, now);
    if (rule) {
      await svc.recordRuleEvent({
        roomId,
        npcId: actingNpcId,
        kind: rule.kind,
        summary: rule.summary,
        playerIds: rule.playerIds,
        npcPositions,
      });
    }
  }
}

function initiatorPlayerIdFromRequest(req: Request): string | undefined {
  const fromHeader = normalizePlayerId(req.get(PLAYER_ID_HEADER));
  if (fromHeader) return fromHeader;
  const bodyInitiator =
    typeof req.body?.initiatorPlayerId === "string"
      ? normalizePlayerId(req.body.initiatorPlayerId)
      : null;
  return bodyInitiator ?? undefined;
}

async function applyActionsHandler(req: Request, res: Response): Promise<void> {
  const { roomId } = req.params;
  const actions = req.body?.actions;
  const actingNpcId = req.body?.actingNpcId;
  const initiatorPlayerId = initiatorPlayerIdFromRequest(req);
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

  let workingState = record.state;
  let applied = 0;
  const playerCells = collectPlayerCells(roomId, workingState);
  const moveAnchorCell = initiatorPlayerId
    ? findPlayerCellByPlayerId(roomId, initiatorPlayerId)
    : null;
  const rawSnapAnchor = req.body?.moveSnapAnchor;
  const moveSnapAnchor =
    rawSnapAnchor &&
    typeof rawSnapAnchor === "object" &&
    Number.isFinite(Number(rawSnapAnchor.x)) &&
    Number.isFinite(Number(rawSnapAnchor.y))
      ? { x: Number(rawSnapAnchor.x), y: Number(rawSnapAnchor.y) }
      : undefined;

  const attitudeCtx = initiatorPlayerId
    ? await CollectiveService.getInstance().getCollectiveContext(
        roomId,
        actingNpcId,
        initiatorPlayerId,
      )
    : null;

  for (const raw of actions) {
    const parsed = safeParseGameAction(raw);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: formatZodError(parsed.error), applied });
      return;
    }

    if (attitudeCtx && isActionBlockedByGate(parsed.data.type, attitudeCtx.band)) {
      res.status(403).json(attitudeGateResponse(attitudeCtx.band, parsed.data.type, applied));
      return;
    }

    try {
      const result = applyGameAction(workingState, parsed.data, actingNpcId, {
        otherPlayerCells: playerCells,
        moveSnapAnchor,
        moveAnchorCell: moveAnchorCell ?? undefined,
      });
      workingState = result.room;
      applied += 1;
      await recordSuccessfulMutation({
        roomId,
        npcId: actingNpcId,
        action: parsed.data,
        jobId,
      });
      void recordActionCollectiveRules(roomId, actingNpcId, initiatorPlayerId, parsed.data).catch(
        (err) => {
          console.error("[apply-actions] collective rule failed", err);
        },
      );
    } catch (err) {
      const message = err instanceof ExecutorError ? err.message : "apply failed";
      res.status(400).json({ ok: false, error: message, applied });
      return;
    }
  }

  const current = setState(roomId, workingState);

  const colyseusRoom = getColyseusRoom(roomId);
  colyseusRoom?.refreshFromMap();

  const needsChunkPersist = actions.some((raw) => {
    const parsed = safeParseGameAction(raw);
    return parsed.success && parsed.data.type === "interact";
  });
  if (needsChunkPersist) {
    const loader = getChunkLoader(roomId);
    await loader.persistDelta(0, 0, { objects: [...current.state.objects] });
  }

  res.json({ ok: true, state: current.state, applied });
}

async function buildMemoryCounts(
  roomId: string,
  playerId: string,
  npcIds: string[],
): Promise<Record<string, number>> {
  const service = MemoryService.getInstance();
  const entries = await Promise.all(
    npcIds.map(
      async (npcId) =>
        [npcId, await service.getMemoryCount(roomId, npcId, playerId)] as const,
    ),
  );
  return Object.fromEntries(entries);
}

/** Worker fetch_state: spatial snapshot + lore only (no memoryCounts — avoids DB contention with memory tail). */
async function buildWorkerStatePayload(
  roomId: string,
  playerId: string,
  options?: { skipNearbyLore?: boolean },
): Promise<{
  state: ReturnType<typeof roomStateForInitiator> & { absoluteGameMinute: number };
  nearbyLore: Array<{ cx: number; cy: number; nameZh: string; flavorOneLine: string }>;
}> {
  const record = getOrCreate(roomId);
  // Include the monotonic room clock so worker day-keyed caps (belief gate
  // D-PLAYER-04/06) reset per real game-day instead of pinning to day-0.
  const viewState = {
    ...roomStateForInitiator(record.state, roomId, playerId),
    absoluteGameMinute: getRoomVoteState(roomId).absoluteGameMinute,
  };
  if (options?.skipNearbyLore) {
    return { state: viewState, nearbyLore: [] };
  }
  const anchor = findPlayerCellByPlayerId(roomId, playerId);
  const nearbyLore = anchor ? await buildNearbyLore(roomId, anchor.x, anchor.y) : [];
  return { state: viewState, nearbyLore };
}

async function buildNearbyLore(
  roomId: string,
  gx: number,
  gy: number,
): Promise<Array<{ cx: number; cy: number; nameZh: string; flavorOneLine: string }>> {
  const { cx, cy } = chunkOf(gx, gy);
  const cells: Array<{ ncx: number; ncy: number }> = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      cells.push({ ncx: cx + dx, ncy: cy + dy });
    }
  }
  const rows = await Promise.all(
    cells.map(async ({ ncx, ncy }) => {
      if (ncx === 0 && ncy === 0) {
        const pub = toChunkLorePublic(HOME_CHUNK_LORE);
        return { cx: ncx, cy: ncy, nameZh: pub.nameZh, flavorOneLine: pub.flavorOneLine };
      }
      const row = await getChunkLoreCached(roomId, ncx, ncy);
      if (!row) return null;
      const pub = toChunkLorePublic(row.lore);
      return { cx: ncx, cy: ncy, nameZh: pub.nameZh, flavorOneLine: pub.flavorOneLine };
    }),
  );
  return rows.filter((row): row is NonNullable<typeof row> => row !== null);
}

export function createRoomsRouter(): Router {
  const router = Router();

  router.get("/:roomId/state", async (req, res) => {
    const { roomId } = req.params;
    const playerId = playerIdFromRequest(req);
    const record = getOrCreate(roomId);
    try {
      const memoryCounts = await buildMemoryCounts(
        roomId,
        playerId,
        record.state.npcs.map((npc) => npc.id),
      );
      const { state: viewState, nearbyLore } = await buildWorkerStatePayload(roomId, playerId);
      res.json({ state: viewState, memoryCounts, nearbyLore });
    } catch (err) {
      const message = err instanceof Error ? err.message : "state failed";
      res.status(500).json({ ok: false, error: message });
    }
  });

  router.post("/:roomId/reset", async (req, res) => {
    const { roomId } = req.params;
    const playerId = playerIdFromRequest(req, req.body);
    const auth = assertScopedPlayerRequest(req, playerId, roomId);
    if (!auth.ok) {
      res.status(auth.status).json({ ok: false, error: auth.error });
      return;
    }
    try {
      const record = reset(roomId);
      resetColyseusFromMap(roomId, record.state, playerId);
      const service = MemoryService.getInstance();
      await service.deleteForPlayer(roomId, playerId);
      await CollectiveService.getInstance().deleteForPlayer(roomId, playerId);
      clearDialogueForPlayer(roomId, playerId);
      clearActionTrackersForPlayer(roomId, playerId);
      moveIntentTracker.clearForPlayer(roomId, playerId);
      const memoryCounts = await buildMemoryCounts(
        roomId,
        playerId,
        record.state.npcs.map((npc) => npc.id),
      );
      res.json({ ok: true, state: record.state, memoryCounts });
    } catch (err) {
      const message = err instanceof Error ? err.message : "reset failed";
      res.status(500).json({ ok: false, error: message });
    }
  });

  router.get("/:roomId/chunks/:cx/:cy/lore", async (req, res) => {
    const { roomId } = req.params;
    const cx = Number.parseInt(req.params.cx, 10);
    const cy = Number.parseInt(req.params.cy, 10);
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) {
      res.status(400).json({ ok: false, error: "invalid chunk coords" });
      return;
    }
    if (cx === 0 && cy === 0) {
      res.json({ ok: true, lore: toChunkLorePublic(HOME_CHUNK_LORE) });
      return;
    }
    const row = await getChunkLore(roomId, cx, cy);
    if (!row) {
      res.status(404).json({ ok: false, error: "lore not found" });
      return;
    }
    res.json({ ok: true, lore: toChunkLorePublic(row.lore) });
  });

  return router;
}

export function createInternalRoomsRouter(): Router {
  const router = Router();

  router.post("/:roomId/apply-actions", requireWorkerAuth, applyActionsHandler);

  /** UAT / D-SESS: drop in-memory dialogue Map for room; Redis transcript stays. */
  router.post("/:roomId/dialogue-map-evict", requireWorkerAuth, (req, res) => {
    const { roomId } = req.params;
    if (!roomId?.trim()) {
      res.status(400).json({ ok: false, error: "roomId required" });
      return;
    }
    const evicted = evictDialogueMapForRoom(roomId);
    res.json({ ok: true, evicted });
  });

  /**
   * UAT seed: append one player+npc turn (Map + Redis mirror) without LLM.
   * Body: { playerId, npcId, playerMessage, npcReply }
   */
  router.post("/:roomId/dialogue-append", requireWorkerAuth, (req, res) => {
    const { roomId } = req.params;
    const playerId = typeof req.body?.playerId === "string" ? req.body.playerId.trim() : "";
    const npcId = typeof req.body?.npcId === "string" ? req.body.npcId.trim() : "";
    const playerMessage =
      typeof req.body?.playerMessage === "string" ? req.body.playerMessage.trim() : "";
    const npcReply = typeof req.body?.npcReply === "string" ? req.body.npcReply.trim() : "";
    if (!roomId?.trim() || !playerId || !npcId || !playerMessage || !npcReply) {
      res.status(400).json({
        ok: false,
        error: "roomId, playerId, npcId, playerMessage, npcReply required",
      });
      return;
    }
    appendCompletedTurn({ roomId, playerId, npcId, playerMessage, npcReply });
    res.json({ ok: true });
  });

  /** UAT / D-SESS: read turns via getRecentTurnsAsync (Map miss → Redis rehydrate). */
  router.get("/:roomId/dialogue-turns", requireWorkerAuth, async (req, res) => {
    const { roomId } = req.params;
    const playerId = typeof req.query.playerId === "string" ? req.query.playerId.trim() : "";
    const npcId = typeof req.query.npcId === "string" ? req.query.npcId.trim() : "";
    const limitRaw = Number(req.query.limit ?? 10);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(40, Math.floor(limitRaw)) : 10;
    if (!roomId?.trim() || !playerId || !npcId) {
      res.status(400).json({ ok: false, error: "roomId, playerId, npcId required" });
      return;
    }
    try {
      const turns = await listDialogueTurnsForUat(roomId, playerId, npcId, limit);
      res.json({ ok: true, turns });
    } catch (err) {
      const message = err instanceof Error ? err.message : "dialogue-turns failed";
      res.status(500).json({ ok: false, error: message });
    }
  });

  router.get("/:roomId/worker-state", requireWorkerAuth, async (req, res) => {
    const { roomId } = req.params;
    const playerId = playerIdFromRequest(req);
    const skipNearbyLore =
      req.query.skipNearbyLore === "1" || req.query.skipNearbyLore === "true";
    const cacheKey = workerStateCacheKey(roomId, playerId, skipNearbyLore);
    const started = Date.now();
    const cached = getCachedWorkerState(cacheKey);
    if (cached) {
      logInternalLatency({
        route: "worker-state",
        ms: Date.now() - started,
        roomId,
        cacheHit: true,
        skipNearbyLore,
      });
      res.json(cached);
      return;
    }
    try {
      const payload = await buildWorkerStatePayload(roomId, playerId, {
        skipNearbyLore,
      });
      setCachedWorkerState(cacheKey, payload, skipNearbyLore);
      logInternalLatency({
        route: "worker-state",
        ms: Date.now() - started,
        roomId,
        cacheHit: false,
        skipNearbyLore,
      });
      res.json(payload);
    } catch (err) {
      const message = err instanceof Error ? err.message : "worker-state failed";
      res.status(500).json({ ok: false, error: message });
    }
  });

  return router;
}
