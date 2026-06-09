import type { NpcState, RoomState } from "@aetherlife/shared";
import { collectPlayerCells } from "../colyseus/bridge.js";
import { buildMoveGrid } from "../colyseus/move-handler.js";
import type { GameRoomState } from "../colyseus/schema.js";
import { applyMapAndBumpVersion } from "../colyseus/version.js";
import type { ChunkLoader } from "../world/chunk-loader.js";
import { buildOtherNpcCells, stepNpcTowardTarget } from "./move.js";
import { resolveScheduleSegment, type ScheduleSegment } from "./schedule.js";

export const MAIN_AMBIENT_NPC_IDS = ["npc-1", "npc-2", "npc-3"] as const;

export type AmbientTickContext = {
  roomId: string;
  gameState: GameRoomState;
  map: RoomState;
  loader: ChunkLoader;
  npcSpeakJobs: ReadonlyMap<string, string>;
  /** Per-NPC waypoint loop index (room-local; not persisted to DB). */
  waypointCursors: Map<string, number>;
};

function shouldSkipMovement(segment: ScheduleSegment): boolean {
  return (
    segment.stationary ||
    segment.activityKey === "idle" ||
    segment.activityKey === "resting"
  );
}

function pickWaypointTarget(
  npc: NpcState,
  segment: ScheduleSegment,
  cursor: number,
): { targetGx: number; targetGy: number; nextCursor: number } {
  const wps = segment.waypoints;
  if (wps.length === 0) {
    return { targetGx: npc.x, targetGy: npc.y, nextCursor: 0 };
  }

  const idx = ((cursor % wps.length) + wps.length) % wps.length;
  const wp = wps[idx]!;
  let nextCursor = cursor;

  if (npc.x === wp.gx && npc.y === wp.gy) {
    if (segment.waypointMode === "once") {
      nextCursor = Math.min(idx + 1, wps.length - 1);
    } else {
      nextCursor = (idx + 1) % wps.length;
    }
  }

  return { targetGx: wp.gx, targetGy: wp.gy, nextCursor };
}

/**
 * Authoritative ambient simulation tick: game clock, schedule activity, ≤1 grid step per NPC.
 * No LLM or HTTP calls (LIFE-03).
 */
export function runAmbientTick(ctx: AmbientTickContext): {
  stateVersion: number;
  delta: ReturnType<typeof applyMapAndBumpVersion>["delta"];
} {
  const { roomId, gameState, map, loader, npcSpeakJobs, waypointCursors } = ctx;

  gameState.gameMinute = (gameState.gameMinute + 1) % 1440;

  const playerCells = collectPlayerCells(roomId, map);

  for (const npc of map.npcs) {
    if (!MAIN_AMBIENT_NPC_IDS.includes(npc.id as (typeof MAIN_AMBIENT_NPC_IDS)[number])) {
      continue;
    }
    if (npcSpeakJobs.has(npc.id)) {
      continue;
    }

    const segment = resolveScheduleSegment(npc.id, gameState.gameMinute);
    if (!segment) {
      npc.activityKey = "idle";
      continue;
    }

    npc.activityKey = segment.activityKey;

    if (shouldSkipMovement(segment)) {
      continue;
    }

    const cursor = waypointCursors.get(npc.id) ?? 0;
    const { targetGx, targetGy, nextCursor } = pickWaypointTarget(npc, segment, cursor);
    waypointCursors.set(npc.id, nextCursor);

    const grid = buildMoveGrid(map, gameState, "", loader, { excludeNpcId: npc.id });
    const otherNpcCells = buildOtherNpcCells(map, npc.id);

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
