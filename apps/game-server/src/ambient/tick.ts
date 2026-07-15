import type { GridCell, NpcState, RoomState } from "@aetherlife/shared";
import {
  COUNCIL_NPC_IDS,
  isCouncilNpcId,
  isTargetIntent,
  isZoneIntent,
  stableStringHash,
} from "@aetherlife/shared";
import { collectPlayerCells, findPlayerCellByPlayerId } from "../colyseus/bridge.js";
import { buildMoveGrid, findNearestWalkableCell } from "../colyseus/move-handler.js";
import type { GameRoomState } from "../colyseus/schema.js";
import { applyMapAndBumpVersion } from "../colyseus/version.js";
import type { ChunkLoader } from "../world/chunk-loader.js";
import { getIntent, isIntentExpired } from "./intent-cache.js";
import { buildOtherNpcCells, stepNpcTowardTarget } from "./move.js";
import {
  resolveScheduleSegment,
  segmentKey,
  shouldSkipMovement,
  type Mobility,
  type ScheduleSegment,
} from "./schedule.js";
import { pickZoneTarget } from "./zone-wander.js";

export const MAIN_AMBIENT_NPC_IDS = COUNCIL_NPC_IDS;

/** Fail-safe: abandon a stuck walk after this many ambient ticks. */
export const WALK_TIMEOUT_TICKS = 48;

/** Pause span 2–8 ticks after arriving (动森式走走停停). */
export function ambientPauseTicks(npcId: string, gameMinute: number): number {
  return 2 + (stableStringHash(`ambient-pause:${npcId}:${gameMinute}`) % 7);
}

/** Per-tick step probability (0–100) by mobility — retained for tests / docs (D-23). */
export function stepPercentForMobility(mobility: Mobility): number {
  return mobility === "wander" ? 55 : 30;
}

/** Deterministic per-NPC-per-minute step gate (D-23/D-24). Resting never reaches walk path. */
export function shouldStepThisTick(npcId: string, gameMinute: number, mobility: Mobility): boolean {
  return stableStringHash(`ambient-step:${npcId}:${gameMinute}`) % 100 < stepPercentForMobility(mobility);
}

export type AmbientMotion = {
  mode: "walking" | "pausing";
  targetGx: number;
  targetGy: number;
  /** Ticks remaining in pause (decremented each ambient tick). */
  pauseTicksLeft: number;
  /** Ticks remaining before walk timeout forces re-pick. */
  walkTicksLeft: number;
  /** Schedule segment that started this hold — invalidate when the active segment changes. */
  segmentKey: string;
};

export type AmbientTickContext = {
  roomId: string;
  gameState: GameRoomState;
  map: RoomState;
  loader: ChunkLoader;
  npcSpeakJobs: ReadonlyMap<string, string>;
  /** Per-NPC recent target cells (anti-repeat wander). */
  recentNpcCells: Map<string, GridCell[]>;
  /** Per-NPC walk/pause cadence (room-local, not Colyseus-synced). */
  ambientMotion?: Map<string, AmbientMotion>;
};

function chebyshev(ax: number, ay: number, bx: number, by: number): number {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

function npcHomeCell(npc: NpcState): GridCell {
  return { x: npc.homeX ?? npc.x, y: npc.homeY ?? npc.y };
}

export function applySoftLeashTarget(
  npc: NpcState,
  targetGx: number,
  targetGy: number,
): { targetGx: number; targetGy: number } {
  const home = npcHomeCell(npc);
  const maxRadius = npc.maxRadius;
  if (maxRadius == null || maxRadius <= 0) {
    return { targetGx, targetGy };
  }
  if (chebyshev(npc.x, npc.y, home.x, home.y) > maxRadius) {
    return { targetGx: home.x, targetGy: home.y };
  }
  if (chebyshev(targetGx, targetGy, home.x, home.y) > maxRadius) {
    const dx = targetGx - home.x;
    const dy = targetGy - home.y;
    const d = Math.max(Math.abs(dx), Math.abs(dy));
    if (d <= 0) {
      return { targetGx: home.x, targetGy: home.y };
    }
    const scale = maxRadius / d;
    return {
      targetGx: Math.round(home.x + dx * scale),
      targetGy: Math.round(home.y + dy * scale),
    };
  }
  return { targetGx, targetGy };
}

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

function syncIntentReasonFromCache(npc: NpcState, roomId: string, gameMinute: number): void {
  const cached = getIntent(roomId, npc.id);
  if (cached && !isIntentExpired(cached.intent, gameMinute, cached.gameMinute)) {
    npc.intentReasonZh = cached.intent.reasonZh?.trim() ?? "";
  }
}

function resolveMovementTarget(
  npc: NpcState,
  segment: ScheduleSegment,
  roomId: string,
  gameMinute: number,
  grid: ReturnType<typeof buildMoveGrid>,
  playerCells: GridCell[],
  recent: GridCell[],
  occupiedCells: readonly GridCell[],
  reservedTargets: readonly GridCell[],
): { targetGx: number; targetGy: number; nextRecent: GridCell[]; source: "join" | "intent" | "zone" } {
  const joinTarget = pickJoinVicinityTarget(npc, roomId, playerCells, grid);
  if (joinTarget) {
    return {
      targetGx: joinTarget.x,
      targetGy: joinTarget.y,
      nextRecent: recent,
      source: "join",
    };
  }

  const zoneOpts = {
    occupiedCells,
    reservedTargets,
  };

  const cached = getIntent(roomId, npc.id);
  if (cached && !isIntentExpired(cached.intent, gameMinute, cached.gameMinute)) {
    npc.intentReasonZh = cached.intent.reasonZh?.trim() ?? "";
    if (isTargetIntent(cached.intent)) {
      return {
        targetGx: cached.intent.target.gx,
        targetGy: cached.intent.target.gy,
        nextRecent: recent,
        source: "intent",
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
        ...zoneOpts,
      });
      return {
        targetGx: picked.targetGx,
        targetGy: picked.targetGy,
        nextRecent: picked.nextRecent,
        source: "zone",
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
    ...zoneOpts,
  });
  return {
    targetGx: picked.targetGx,
    targetGy: picked.targetGy,
    nextRecent: picked.nextRecent,
    source: "zone",
  };
}

/** Destinations already claimed by held walks — seed before per-NPC target picks (never-stack). */
export function collectWalkingReservedTargets(
  ambientMotion: ReadonlyMap<string, AmbientMotion>,
): GridCell[] {
  const reserved: GridCell[] = [];
  for (const motion of ambientMotion.values()) {
    if (motion.mode === "walking") {
      reserved.push({ x: motion.targetGx, y: motion.targetGy });
    }
  }
  return reserved;
}

function beginWalk(
  motionMap: Map<string, AmbientMotion>,
  npcId: string,
  targetGx: number,
  targetGy: number,
  holdSegmentKey: string,
): void {
  motionMap.set(npcId, {
    mode: "walking",
    targetGx,
    targetGy,
    pauseTicksLeft: 0,
    walkTicksLeft: WALK_TIMEOUT_TICKS,
    segmentKey: holdSegmentKey,
  });
}

function beginPause(
  motionMap: Map<string, AmbientMotion>,
  npcId: string,
  gameMinute: number,
  x: number,
  y: number,
  holdSegmentKey: string,
): void {
  motionMap.set(npcId, {
    mode: "pausing",
    targetGx: x,
    targetGy: y,
    pauseTicksLeft: ambientPauseTicks(npcId, gameMinute),
    walkTicksLeft: 0,
    segmentKey: holdSegmentKey,
  });
}

/**
 * Authoritative ambient simulation tick: game clock, schedule activity, ≤1 grid step per NPC.
 * Walk/pause cadence (动森式); never stack when alternatives exist. No LLM/HTTP (LIFE-03).
 */
export function runAmbientTick(ctx: AmbientTickContext): {
  stateVersion: number;
  delta: ReturnType<typeof applyMapAndBumpVersion>["delta"];
} {
  const { roomId, gameState, map, loader, npcSpeakJobs, recentNpcCells } = ctx;
  const ambientMotion = ctx.ambientMotion ?? new Map<string, AmbientMotion>();

  gameState.gameMinute = (gameState.gameMinute + 1) % 1440;
  const gameMinute = gameState.gameMinute;

  const playerCells = collectPlayerCells(roomId, map);
  const reservedTargets: GridCell[] = collectWalkingReservedTargets(ambientMotion);

  for (const npc of map.npcs) {
    if (!isCouncilNpcId(npc.id)) {
      continue;
    }
    if (npcSpeakJobs.has(npc.id)) {
      ambientMotion.delete(npc.id);
      continue;
    }

    clearJoinVicinityIfDone(npc, playerCells);

    const segment = resolveScheduleSegment(npc.id, gameMinute);
    if (!segment) {
      npc.activityKey = "idle";
      ambientMotion.delete(npc.id);
      continue;
    }

    npc.activityKey = segment.activityKey;
    syncIntentReasonFromCache(npc, roomId, gameMinute);

    if (shouldSkipMovement(segment)) {
      ambientMotion.delete(npc.id);
      continue;
    }

    if (npc.maxRadius === 0) {
      ambientMotion.delete(npc.id);
      continue;
    }

    const activeSegmentKey = segmentKey(segment);
    let motion = ambientMotion.get(npc.id);
    if (motion && motion.segmentKey !== activeSegmentKey) {
      ambientMotion.delete(npc.id);
      motion = undefined;
    }

    // join_vicinity interrupts pause/walk hold
    if (npc.joinVicinityActive) {
      ambientMotion.delete(npc.id);
      motion = undefined;
    } else if (motion?.mode === "pausing") {
      motion.pauseTicksLeft -= 1;
      if (motion.pauseTicksLeft > 0) {
        ambientMotion.set(npc.id, motion);
        continue;
      }
      ambientMotion.delete(npc.id);
      motion = undefined;
    }

    const grid = buildMoveGrid(map, gameState, "", loader, { excludeNpcId: npc.id });
    const otherNpcCells = buildOtherNpcCells(map, npc.id);
    const recent = recentNpcCells.get(npc.id) ?? [];

    const holdingWalk =
      motion?.mode === "walking" &&
      motion.walkTicksLeft > 0 &&
      (motion.targetGx !== npc.x || motion.targetGy !== npc.y) &&
      !npc.joinVicinityActive;

    let resolved: {
      targetGx: number;
      targetGy: number;
      nextRecent: GridCell[];
      source: "join" | "intent" | "zone";
    };

    if (holdingWalk && motion) {
      motion.walkTicksLeft -= 1;
      ambientMotion.set(npc.id, motion);
      resolved = {
        targetGx: motion.targetGx,
        targetGy: motion.targetGy,
        nextRecent: recent,
        source: "zone",
      };
    } else {
      resolved = resolveMovementTarget(
        npc,
        segment,
        roomId,
        gameMinute,
        grid,
        playerCells,
        recent,
        otherNpcCells,
        reservedTargets,
      );
      recentNpcCells.set(npc.id, resolved.nextRecent);
      if (resolved.source !== "join") {
        reservedTargets.push({ x: resolved.targetGx, y: resolved.targetGy });
        beginWalk(ambientMotion, npc.id, resolved.targetGx, resolved.targetGy, activeSegmentKey);
      }
    }

    const leashed =
      resolved.source === "join"
        ? { targetGx: resolved.targetGx, targetGy: resolved.targetGy }
        : applySoftLeashTarget(npc, resolved.targetGx, resolved.targetGy);

    // If soft-leash retargets, keep motion in sync so we don't oscillate.
    if (resolved.source !== "join") {
      const cur = ambientMotion.get(npc.id);
      if (cur?.mode === "walking" && (cur.targetGx !== leashed.targetGx || cur.targetGy !== leashed.targetGy)) {
        cur.targetGx = leashed.targetGx;
        cur.targetGy = leashed.targetGy;
        ambientMotion.set(npc.id, cur);
      }
    }

    const step = stepNpcTowardTarget({
      npcX: npc.x,
      npcY: npc.y,
      targetGx: leashed.targetGx,
      targetGy: leashed.targetGy,
      grid,
      playerCells,
      otherNpcCells,
    });

    if (step.moved) {
      npc.x = step.x;
      npc.y = step.y;
    }

    if (resolved.source !== "join" && npc.x === leashed.targetGx && npc.y === leashed.targetGy) {
      beginPause(ambientMotion, npc.id, gameMinute, npc.x, npc.y, activeSegmentKey);
    }
  }

  return applyMapAndBumpVersion(gameState, map);
}
