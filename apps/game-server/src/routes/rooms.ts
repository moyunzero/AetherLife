import { Router, type Request, type Response, type NextFunction } from "express";
import { safeParseGameAction, type GameAction } from "@aetherlife/game-actions";
import {
  findNpc,
  HOME_CHUNK_LORE,
  chunkOf,
  toChunkLorePublic,
  type CollectivePosition,
} from "@aetherlife/shared";
import { applyGameAction, ExecutorError } from "../room/executor.js";
import { recordSuccessfulMutation } from "../audit/record.js";
import { MemoryService } from "../memory/service.js";
import {
  clearActionTrackersForRoom,
  detectRoomCollaborateTransfer,
  detectRoomCompeteObject,
  recordRoomNpcTransfer,
  recordRoomObjectInteract,
} from "../collective/action-tracker.js";
import { attitudeGateResponse, isActionBlockedByGate } from "../collective/gate.js";
import { moveIntentTracker } from "../collective/move-intent-tracker.js";
import { CollectiveService } from "../collective/service.js";
import {
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
import { clearDialogueForPlayer } from "../npc/dialogue-session.js";
import {
  getCachedWorkerState,
  setCachedWorkerState,
  workerStateCacheKey,
} from "../colyseus/workerStateCache.js";
import { requireWorkerAuth } from "./internal.js";

/**
 * Transform a Zod-like validation error into a list of readable issue objects.
 *
 * @param error - An object with an `issues` array where each issue has a `path` (an array of string|number segments) and a `message`
 * @returns An array of `{ path: string, message: string }` where `path` is the original issue path joined by `.` and `message` is the issue message
 */
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

/**
 * Validate and apply an ordered list of game actions to a room, mutate the room state, enforce collective gates, audit successful mutations, and respond with the updated state and how many actions were applied.
 *
 * Validates request shape and acting NPC, parses each action in order, blocks actions disallowed by collective gate state (responding 403), applies actions (responding 400 on executor errors or parse failures) and records successful mutations. After applying actions it refreshes the Colyseus room, persists chunk object deltas if any successfully-parsed action is of type `"interact"`, and responds with `{ ok: true, state, applied }`. Recording of collective-rule events is performed asynchronously; failures in that background task are logged and do not affect the HTTP response.
 */
async function applyActionsHandler(req: Request, res: Response): Promise<void> {
  const { roomId } = req.params;
  const actions = req.body?.actions;
  const actingNpcId = req.body?.actingNpcId;
  const initiatorPlayerId =
    typeof req.body?.initiatorPlayerId === "string" ? req.body.initiatorPlayerId : undefined;
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
  const playerCells = collectPlayerCells(roomId, record.state);
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
      const result = applyGameAction(current.state, parsed.data, actingNpcId, {
        otherPlayerCells: playerCells,
        moveSnapAnchor,
        moveAnchorCell: moveAnchorCell ?? undefined,
      });
      current = setState(roomId, result.room);
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

/**
 * Build a worker payload containing the room view state for a specific player and nearby chunk lore.
 *
 * @param roomId - The room identifier
 * @param playerId - The player identifier used to compute the viewable state and lore anchor
 * @param options - Optional flags controlling payload contents
 * @param options.skipNearbyLore - If true, `nearbyLore` will be an empty array and lore lookup will be skipped
 * @returns An object with `state` (the view of the room for the given player) and `nearbyLore` (an array of nearby chunk lore entries, each with `cx`, `cy`, `nameZh`, and `flavorOneLine`)
 */
async function buildWorkerStatePayload(
  roomId: string,
  playerId: string,
  options?: { skipNearbyLore?: boolean },
): Promise<{
  state: ReturnType<typeof roomStateForInitiator>;
  nearbyLore: Array<{ cx: number; cy: number; nameZh: string; flavorOneLine: string }>;
}> {
  const record = getOrCreate(roomId);
  const viewState = roomStateForInitiator(record.state, roomId, playerId);
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
  const out: Array<{ cx: number; cy: number; nameZh: string; flavorOneLine: string }> = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const ncx = cx + dx;
      const ncy = cy + dy;
      if (ncx === 0 && ncy === 0) {
        const pub = toChunkLorePublic(HOME_CHUNK_LORE);
        out.push({ cx: ncx, cy: ncy, nameZh: pub.nameZh, flavorOneLine: pub.flavorOneLine });
        continue;
      }
      const row = await getChunkLore(roomId, ncx, ncy);
      if (!row) continue;
      const pub = toChunkLorePublic(row.lore);
      out.push({ cx: ncx, cy: ncy, nameZh: pub.nameZh, flavorOneLine: pub.flavorOneLine });
    }
  }
  return out;
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
    try {
      const record = reset(roomId);
      resetColyseusFromMap(roomId, record.state);
      const service = MemoryService.getInstance();
      await service.deleteForPlayer(roomId, playerId);
      await CollectiveService.getInstance().deleteForRoom(roomId);
      clearDialogueForPlayer(roomId, playerId);
      clearActionTrackersForRoom(roomId);
      moveIntentTracker.clearRoom(roomId);
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

  router.post("/:roomId/apply-actions", applyActionsHandler);

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

/**
 * Create an Express Router exposing internal worker endpoints for room operations.
 *
 * The router enforces optional internal token auth for POST /:roomId/apply-actions,
 * requires worker auth for GET /:roomId/worker-state, serves a cached worker-state
 * payload (honoring a `skipNearbyLore` query flag), and delegates action application
 * to the shared `applyActionsHandler`.
 *
 * @returns An Express `Router` configured with the internal room endpoints
 */
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

  router.get("/:roomId/worker-state", requireWorkerAuth, async (req, res) => {
    const { roomId } = req.params;
    const playerId = playerIdFromRequest(req);
    const skipNearbyLore =
      req.query.skipNearbyLore === "1" || req.query.skipNearbyLore === "true";
    const cacheKey = workerStateCacheKey(roomId, playerId, skipNearbyLore);
    const cached = getCachedWorkerState(cacheKey);
    if (cached) {
      res.json(cached);
      return;
    }
    try {
      const payload = await buildWorkerStatePayload(roomId, playerId, {
        skipNearbyLore,
      });
      setCachedWorkerState(cacheKey, payload);
      res.json(payload);
    } catch (err) {
      const message = err instanceof Error ? err.message : "worker-state failed";
      res.status(500).json({ ok: false, error: message });
    }
  });

  return router;
}
