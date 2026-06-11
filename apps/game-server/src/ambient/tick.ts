import type { GridCell, NpcState, RoomState } from "@aetherlife/shared";
import { isBackgroundNpc, isTargetIntent, isZoneIntent } from "@aetherlife/shared";
import { collectPlayerCells, findPlayerCellByPlayerId } from "../colyseus/bridge.js";
import { buildMoveGrid, findNearestWalkableCell } from "../colyseus/move-handler.js";
import type { GameRoomState } from "../colyseus/schema.js";
import { applyMapAndBumpVersion } from "../colyseus/version.js";
import type { ChunkLoader } from "../world/chunk-loader.js";
import { getIntent, isIntentExpired } from "./intent-cache.js";
import { buildOtherNpcCells, stepNpcTowardTarget } from "./move.js";
import { resolveScheduleSegment, shouldSkipMovement, type ScheduleSegment } from "./schedule.js";
import { pickZoneTarget } from "./zone-wander.js";

export const MAIN_AMBIENT_NPC_IDS = ["npc-1", "npc-2", "npc-3"] as const;

/**
 * Checks whether the given NPC ID identifies a main ambient NPC.
 *
 * @param npcId - The NPC identifier to check.
 * @returns `true` if `npcId` is one of the `MAIN_AMBIENT_NPC_IDS`, `false` otherwise.
 */
function isMainAmbientNpcId(npcId: string): npcId is (typeof MAIN_AMBIENT_NPC_IDS)[number] {
  return (MAIN_AMBIENT_NPC_IDS as readonly string[]).includes(npcId);
}

/**
 * Produce a full-day wandering schedule segment for an NPC's configured background zone, or return `null` if none is set.
 *
 * @param npc - NPC state used to read the background wander zone and fallback activity
 * @returns A `ScheduleSegment` covering minutes 0–1440 with `mobility: "wander"` and `activityKey` from the NPC (or `"wandering"`), or `null` if the NPC has no background wander zone configured
 */
function backgroundWanderSegment(npc: NpcState): ScheduleSegment | null {
  const zoneId = npc.backgroundWanderZoneId?.trim();
  if (!zoneId) return null;
  return {
    zoneId,
    activityKey: npc.activityKey ?? "wandering",
    mobility: "wander",
    fromMinute: 0,
    toMinute: 1440,
  };
}

/**
 * Advances a background NPC's ambient behavior for one tick: sets its wander activity, selects a zone target, updates recent-target memory, and moves the NPC at most one grid step toward that target.
 *
 * Updates the NPC's `activityKey`, clears `intentReasonZh`, writes the NPC's new `x`/`y` if movement occurs, and updates `recentNpcCells` in `ctx`.
 *
 * @param npc - The background NPC state to update
 * @param ctx - Partial ambient tick context; uses `gameState`, `map`, `loader`, and `recentNpcCells` (the function will update `recentNpcCells` for `npc.id`)
 * @param playerCells - Positions of players in the room used when selecting safe/appropriate targets
 */
function runBackgroundNpcTick(
  npc: NpcState,
  ctx: Pick<AmbientTickContext, "gameState" | "map" | "loader" | "recentNpcCells">,
  playerCells: GridCell[],
): void {
  const segment = backgroundWanderSegment(npc);
  if (!segment) {
    npc.activityKey = "idle";
    return;
  }

  npc.activityKey = segment.activityKey;
  npc.intentReasonZh = "";

  if (shouldSkipMovement(segment)) {
    return;
  }

  const { gameState, map, loader, recentNpcCells } = ctx;
  const grid = buildMoveGrid(map, gameState, "", loader, { excludeNpcId: npc.id });
  const otherNpcCells = buildOtherNpcCells(map, npc.id);
  const recent = recentNpcCells.get(npc.id) ?? [];

  const picked = pickZoneTarget({
    npc,
    segment,
    grid,
    playerCells,
    recentCells: recent,
    gameMinute: gameState.gameMinute,
  });
  recentNpcCells.set(npc.id, picked.nextRecent);

  const step = stepNpcTowardTarget({
    npcX: npc.x,
    npcY: npc.y,
    targetGx: picked.targetGx,
    targetGy: picked.targetGy,
    grid,
    playerCells,
    otherNpcCells,
  });

  if (step.moved) {
    npc.x = step.x;
    npc.y = step.y;
  }
}

export type AmbientTickContext = {
  roomId: string;
  gameState: GameRoomState;
  map: RoomState;
  loader: ChunkLoader;
  npcSpeakJobs: ReadonlyMap<string, string>;
  /** Per-NPC recent target cells (anti-repeat wander). */
  recentNpcCells: Map<string, GridCell[]>;
};

/**
 * Computes the Chebyshev distance between two grid coordinates.
 *
 * @param ax - X coordinate of the first point
 * @param ay - Y coordinate of the first point
 * @param bx - X coordinate of the second point
 * @param by - Y coordinate of the second point
 * @returns The Chebyshev distance (the larger of the absolute differences in x and y)
 */
function chebyshev(ax: number, ay: number, bx: number, by: number): number {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

/**
 * Clears an NPC's join-vicinity state when its join window has expired or a player is within Chebyshev distance 2.
 *
 * @param npc - NPC state to update; this may modify `joinVicinityActive`, `joinVicinityUntil`, `joinVicinityStartedAt`, and `joinVicinityPlayerId`
 * @param playerCells - Positions of players in the room used to determine proximity
 */
function clearJoinVicinityIfDone(npc: NpcState, playerCells: GridCell[]): void {
  if (!npc.joinVicinityActive) return;
  const now = Date.now();
  const expired = (npc.joinVicinityUntil ?? 0) > 0 && now >= (npc.joinVicinityUntil ?? 0);
  const nearPlayer = playerCells.some((p) => chebyshev(npc.x, npc.y, p.x, p.y) <= 2);
  if (expired || nearPlayer) {
    npc.joinVicinityActive = false;
    npc.joinVicinityUntil = 0;
    npc.joinVicinityStartedAt = 0;
    npc.joinVicinityPlayerId = undefined;
  }
}

/**
 * Selects a walkable grid cell near a player for an NPC that is actively trying to "join" players.
 *
 * If the NPC's join-vicinity is not active or has expired, returns `null`. Prefers a cell adjacent to the player identified by `npc.joinVicinityPlayerId` when available; otherwise uses the closest player from `playerCells`. From the chosen player cell, returns the nearest non-center adjacent walkable cell; if none exist, returns the nearest walkable cell to the player.
 *
 * @param npc - NPC state (used for position and join-vicinity metadata)
 * @param roomId - Room identifier (used to resolve a player by ID)
 * @param playerCells - Current player positions in the room
 * @param grid - Movement grid used to test walkability
 * @returns The selected `GridCell` to move toward, or `null` if no valid join-vicinity target exists
 */
export function pickJoinVicinityTarget(
  npc: NpcState,
  roomId: string,
  playerCells: GridCell[],
  grid: ReturnType<typeof buildMoveGrid>,
): GridCell | null {
  if (!npc.joinVicinityActive) return null;
  const until = npc.joinVicinityUntil ?? 0;
  if (until > 0 && Date.now() >= until) return null;

  let playerCell: GridCell | null = null;
  if (npc.joinVicinityPlayerId) {
    playerCell = findPlayerCellByPlayerId(roomId, npc.joinVicinityPlayerId);
  }
  if (!playerCell && playerCells.length > 0) {
    let best = playerCells[0]!;
    let bestD = chebyshev(npc.x, npc.y, best.x, best.y);
    for (const p of playerCells.slice(1)) {
      const d = chebyshev(npc.x, npc.y, p.x, p.y);
      if (d < bestD) {
        best = p;
        bestD = d;
      }
    }
    playerCell = best;
  }
  if (!playerCell) return null;

  const candidates: GridCell[] = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if (dx === 0 && dy === 0) continue;
      const gx = playerCell.x + dx;
      const gy = playerCell.y + dy;
      if (!grid.isBlocked(gx, gy)) {
        candidates.push({ x: gx, y: gy });
      }
    }
  }
  if (candidates.length === 0) {
    const nearest = findNearestWalkableCell(playerCell.x, playerCell.y, grid);
    return { x: nearest.x, y: nearest.y };
  }
  candidates.sort(
    (a, b) =>
      chebyshev(npc.x, npc.y, a.x, a.y) - chebyshev(npc.x, npc.y, b.x, b.y),
  );
  return candidates[0] ?? null;
}

/**
 * Update an NPC's `intentReasonZh` from the cached intent when a valid, non-expired intent exists.
 *
 * @param npc - NPC state object to update
 * @param roomId - Room identifier used to fetch the cached intent
 * @param gameMinute - Current game minute used to validate intent expiry
 */
function syncIntentReasonFromCache(npc: NpcState, roomId: string, gameMinute: number): void {
  const cached = getIntent(roomId, npc.id);
  if (cached && !isIntentExpired(cached.intent, gameMinute, cached.gameMinute)) {
    npc.intentReasonZh = cached.intent.reasonZh?.trim() ?? "";
  }
}

/**
 * Selects the grid cell this NPC should move toward for the current tick, honoring join-vicinity behavior, cached intents, and the NPC's schedule zone.
 *
 * Updates the NPC's `intentReasonZh` when a valid cached intent is applied.
 *
 * @param npc - The NPC state being resolved (may be mutated to reflect intent reason).
 * @param segment - The resolved schedule segment used for zone-based targeting.
 * @param roomId - Room identifier used to look up cached intents.
 * @param gameMinute - Current game minute used to evaluate intent expiration.
 * @param grid - Movement grid describing walkability and obstacles for target selection.
 * @param playerCells - Positions of players in the room used for join-vicinity and target selection.
 * @param recent - Recent target cells for this NPC used to bias selection to avoid repeats; may be returned unchanged or replaced.
 * @returns An object with:
 *  - `targetGx`/`targetGy`: coordinates of the chosen target cell to move toward.
 *  - `nextRecent`: the updated recent-cells list to store for this NPC.
 */
function resolveMovementTarget(
  npc: NpcState,
  segment: ScheduleSegment,
  roomId: string,
  gameMinute: number,
  grid: ReturnType<typeof buildMoveGrid>,
  playerCells: GridCell[],
  recent: GridCell[],
): { targetGx: number; targetGy: number; nextRecent: GridCell[] } {
  const joinTarget = pickJoinVicinityTarget(npc, roomId, playerCells, grid);
  if (joinTarget) {
    return {
      targetGx: joinTarget.x,
      targetGy: joinTarget.y,
      nextRecent: recent,
    };
  }

  const cached = getIntent(roomId, npc.id);
  if (cached && !isIntentExpired(cached.intent, gameMinute, cached.gameMinute)) {
    npc.intentReasonZh = cached.intent.reasonZh?.trim() ?? "";
    if (isTargetIntent(cached.intent)) {
      return {
        targetGx: cached.intent.target.gx,
        targetGy: cached.intent.target.gy,
        nextRecent: recent,
      };
    }
    if (isZoneIntent(cached.intent)) {
      const biasedSegment: ScheduleSegment = { ...segment, zoneId: cached.intent.zoneId };
      const picked = pickZoneTarget({
        npc,
        segment: biasedSegment,
        grid,
        playerCells,
        recentCells: recent,
        gameMinute,
      });
      return {
        targetGx: picked.targetGx,
        targetGy: picked.targetGy,
        nextRecent: picked.nextRecent,
      };
    }
  }

  const picked = pickZoneTarget({
    npc,
    segment,
    grid,
    playerCells,
    recentCells: recent,
    gameMinute,
  });
  return {
    targetGx: picked.targetGx,
    targetGy: picked.targetGy,
    nextRecent: picked.nextRecent,
  };
}

/**
 * Advance the authoritative ambient simulation by one minute, update each main/background NPC's activity and at most one grid step, and persist map/version changes.
 *
 * @param ctx - Ambient tick context containing room, game state, map, loader, active NPC speak jobs, and per-NPC recent target memory
 * @returns An object with `stateVersion` (new game/map state version) and `delta` describing the applied map changes
 */
export function runAmbientTick(ctx: AmbientTickContext): {
  stateVersion: number;
  delta: ReturnType<typeof applyMapAndBumpVersion>["delta"];
} {
  const { roomId, gameState, map, loader, npcSpeakJobs, recentNpcCells } = ctx;

  gameState.gameMinute = (gameState.gameMinute + 1) % 1440;

  const playerCells = collectPlayerCells(roomId, map);

  for (const npc of map.npcs) {
    const isMain = isMainAmbientNpcId(npc.id);
    const isBg = isBackgroundNpc(npc);
    if (!isMain && !isBg) {
      continue;
    }
    if (npcSpeakJobs.has(npc.id)) {
      continue;
    }

    if (isBg) {
      runBackgroundNpcTick(npc, ctx, playerCells);
      continue;
    }

    clearJoinVicinityIfDone(npc, playerCells);

    const segment = resolveScheduleSegment(npc.id, gameState.gameMinute);
    if (!segment) {
      npc.activityKey = "idle";
      continue;
    }

    npc.activityKey = segment.activityKey;
    syncIntentReasonFromCache(npc, roomId, gameState.gameMinute);

    if (shouldSkipMovement(segment)) {
      continue;
    }

    const grid = buildMoveGrid(map, gameState, "", loader, { excludeNpcId: npc.id });
    const otherNpcCells = buildOtherNpcCells(map, npc.id);
    const recent = recentNpcCells.get(npc.id) ?? [];

    const { targetGx, targetGy, nextRecent } = resolveMovementTarget(
      npc,
      segment,
      roomId,
      gameState.gameMinute,
      grid,
      playerCells,
      recent,
    );
    recentNpcCells.set(npc.id, nextRecent);

    const step = stepNpcTowardTarget({
      npcX: npc.x,
      npcY: npc.y,
      targetGx,
      targetGy,
      grid,
      playerCells,
      otherNpcCells,
    });

    if (step.moved) {
      npc.x = step.x;
      npc.y = step.y;
    }
  }

  return applyMapAndBumpVersion(gameState, map);
}
