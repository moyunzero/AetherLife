import type { GridCell, NpcState, RoomState } from "@aetherlife/shared";
import { COUNCIL_NPC_IDS, isCouncilNpcId, isTargetIntent, isZoneIntent } from "@aetherlife/shared";
import { collectPlayerCells, findPlayerCellByPlayerId } from "../colyseus/bridge.js";
import { buildMoveGrid, findNearestWalkableCell } from "../colyseus/move-handler.js";
import type { GameRoomState } from "../colyseus/schema.js";
import { applyMapAndBumpVersion } from "../colyseus/version.js";
import type { ChunkLoader } from "../world/chunk-loader.js";
import { getIntent, isIntentExpired } from "./intent-cache.js";
import { buildOtherNpcCells, stepNpcTowardTarget } from "./move.js";
import { resolveScheduleSegment, shouldSkipMovement, type ScheduleSegment } from "./schedule.js";
import { pickZoneTarget } from "./zone-wander.js";

export const MAIN_AMBIENT_NPC_IDS = COUNCIL_NPC_IDS;

const AMBIENT_BUCKET_COUNT = 12;

/** Stable 0..11 bucket per council seat — one NPC moves per bucket per tick (D-MAP-AMB-03). */
export function hashNpcBucket(npcId: string): number {
  const match = /^npc-(\d+)$/.exec(npcId);
  if (match) {
    const seat = Number.parseInt(match[1]!, 10);
    if (seat >= 1 && seat <= AMBIENT_BUCKET_COUNT) {
      return (seat - 1) % AMBIENT_BUCKET_COUNT;
    }
  }
  let hash = 0;
  for (let i = 0; i < npcId.length; i += 1) {
    hash = (hash * 31 + npcId.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % AMBIENT_BUCKET_COUNT;
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
 * Authoritative ambient simulation tick: game clock, schedule activity, ≤1 grid step per NPC.
 * No LLM or HTTP calls (LIFE-03).
 */
export function runAmbientTick(ctx: AmbientTickContext): {
  stateVersion: number;
  delta: ReturnType<typeof applyMapAndBumpVersion>["delta"];
} {
  const { roomId, gameState, map, loader, npcSpeakJobs, recentNpcCells } = ctx;

  gameState.gameMinute = (gameState.gameMinute + 1) % 1440;

  const playerCells = collectPlayerCells(roomId, map);

  for (const npc of map.npcs) {
    if (!isCouncilNpcId(npc.id)) {
      continue;
    }
    if (npcSpeakJobs.has(npc.id)) {
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

    if (npc.maxRadius === 0) {
      continue;
    }

    if (gameState.gameMinute % AMBIENT_BUCKET_COUNT !== hashNpcBucket(npc.id)) {
      continue;
    }

    const grid = buildMoveGrid(map, gameState, "", loader, { excludeNpcId: npc.id });
    const otherNpcCells = buildOtherNpcCells(map, npc.id);
    const recent = recentNpcCells.get(npc.id) ?? [];

    const resolved = resolveMovementTarget(
      npc,
      segment,
      roomId,
      gameState.gameMinute,
      grid,
      playerCells,
      recent,
    );
    recentNpcCells.set(npc.id, resolved.nextRecent);

    const leashed = applySoftLeashTarget(npc, resolved.targetGx, resolved.targetGy);

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
  }

  return applyMapAndBumpVersion(gameState, map);
}
