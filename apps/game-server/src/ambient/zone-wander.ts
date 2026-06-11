import {
  getWorldRegistry,
  parseZoneId,
  stableStringHash,
  toGlobal,
  type GlobalMoveGrid,
  type GridCell,
  type NpcState,
  type WorldRegistry,
  type Zone,
  type ZoneId,
} from "@aetherlife/shared";
import type { ScheduleSegment } from "./schedule.js";
import { isLingerMobility } from "./schedule.js";

const MAX_RECENT = 8;
const SOCIAL_BIAS_DISTANCE = 3;
const SOCIAL_BIAS_ACTIVITIES = new Set(["socializing", "patrol"]);
/** Chebyshev radius (cells) for stationary/poi linger — 动森/星露谷式「在工位附近晃」. See ambient/README.md */
export const LINGER_RADIUS = 2;
/** Per-tick probability (0–100) to stand still during linger; hash-stable per npcId+gameMinute. */
export const LINGER_PAUSE_PERCENT = 30;
/** Max walkable cells sampled per zone per tick — caps DoS from huge zone rects (T-16-02). */
export const MAX_ZONE_SAMPLE_CELLS = 256;

/**
 * Decide if an NPC should pause movement during a linger period for the given game minute using a stable, deterministic hash.
 *
 * @param npcId - Unique identifier for the NPC
 * @param gameMinute - Current in-game minute used to stabilize per-minute behavior
 * @returns `true` if the NPC should pause this minute, `false` otherwise
 */
function shouldPauseLinger(npcId: string, gameMinute: number): boolean {
  return stableStringHash(`linger:${npcId}:${gameMinute}`) % 100 < LINGER_PAUSE_PERCENT;
}

/**
 * Compute the Chebyshev distance between two grid coordinates.
 *
 * @param ax - X coordinate of the first point
 * @param ay - Y coordinate of the first point
 * @param bx - X coordinate of the second point
 * @param by - Y coordinate of the second point
 * @returns The Chebyshev distance (the larger of the absolute x and y differences) between the two points
 */
function chebyshev(ax: number, ay: number, bx: number, by: number): number {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

/**
 * Finds a zone by its zone identifier.
 *
 * @param zoneId - Zone identifier that includes region and local IDs (e.g., a `ZoneId`-formatted string)
 * @returns The matching `Zone` if present in the registry, or `undefined` if no match is found
 */
function findZone(registry: WorldRegistry, zoneId: string): Zone | undefined {
  const { regionId, localId } = parseZoneId(zoneId as ZoneId);
  const zones = registry.zonesByRegion.get(regionId);
  return zones?.find((z) => z.localId === localId);
}

/**
 * Decides whether a zone-local cell should be included when deterministically subsampling large zone rectangles.
 *
 * @param zoneId - Zone identifier used to stabilize sampling across ticks
 * @param lx - Local x coordinate within the zone
 * @param ly - Local y coordinate within the zone
 * @param rect - Zone rectangle with width `w` and height `h` used to compute sampling density
 * @returns `true` if the cell should be sampled (included), `false` otherwise
 */
export function shouldSampleZoneCell(
  zoneId: string,
  lx: number,
  ly: number,
  rect: { w: number; h: number },
): boolean {
  const area = rect.w * rect.h;
  if (area <= MAX_ZONE_SAMPLE_CELLS) return true;
  const stride = Math.ceil(area / MAX_ZONE_SAMPLE_CELLS);
  return stableStringHash(`${zoneId}:${lx}:${ly}`) % stride === 0;
}

/**
 * Append a grid cell to an NPC's recent-cell history and trim the history to at most MAX_RECENT entries.
 *
 * @param recent - The current recent-cell history (ordered from oldest to newest)
 * @param cell - The grid cell to append to the history
 * @returns The updated recent-cell history with `cell` appended; oldest entries removed if needed to keep length at or below `MAX_RECENT`
 */
function pushRecent(recent: GridCell[], cell: GridCell): GridCell[] {
  const next = [...recent, cell];
  if (next.length > MAX_RECENT) next.shift();
  return next;
}

export type ZoneWanderInput = {
  npc: NpcState;
  segment: ScheduleSegment;
  grid: GlobalMoveGrid;
  playerCells: readonly GridCell[];
  recentCells: GridCell[];
  /** Game clock minute — stabilizes linger pause cadence per tick. */
  gameMinute: number;
};

/**
 * Selects a navigation target for an NPC inside the segment's zone, applying POI preference, deterministic zone sampling, linger pausing, optional social bias toward nearby players, and avoidance of recently visited cells.
 *
 * @param input - ZoneWanderInput describing the NPC state, schedule segment (zoneId, mobility, activityKey), movement grid, nearby player cells, recent target history, and current game minute.
 * @returns An object containing `targetGx` and `targetGy` (the chosen global grid coordinates) and `nextRecent` (the updated recent-cells list including the chosen target)
 */
export function pickZoneTarget(input: ZoneWanderInput): {
  targetGx: number;
  targetGy: number;
  nextRecent: GridCell[];
} {
  const registry = getWorldRegistry();
  const fallback = {
    targetGx: input.npc.x,
    targetGy: input.npc.y,
    nextRecent: input.recentCells,
  };
  if (!registry) return fallback;

  const zone = findZone(registry, input.segment.zoneId);
  if (!zone) return fallback;

  const region = registry.regions.find((r) => r.id === zone.regionId);
  if (!region) return fallback;

  if (input.segment.mobility === "poi") {
    const pois = registry.poisByRegion.get(zone.regionId) ?? [];
    const socialPoi =
      pois.find((p) => p.kind === "social") ?? pois.find((p) => p.localId === "well");
    if (socialPoi) {
      const { gx, gy } = toGlobal(region, socialPoi.lx, socialPoi.ly);
      if (!input.grid.isBlocked(gx, gy)) {
        return {
          targetGx: gx,
          targetGy: gy,
          nextRecent: pushRecent(input.recentCells, { x: gx, y: gy }),
        };
      }
    }
  }

  const candidates: GridCell[] = [];
  const { rect } = zone;
  for (let lx = rect.lx; lx < rect.lx + rect.w; lx++) {
    for (let ly = rect.ly; ly < rect.ly + rect.h; ly++) {
      if (!shouldSampleZoneCell(zone.zoneId, lx, ly, rect)) continue;
      const { gx, gy } = toGlobal(region, lx, ly);
      if (!input.grid.isBlocked(gx, gy)) {
        candidates.push({ x: gx, y: gy });
      }
    }
  }

  if (candidates.length === 0) return fallback;

  let pool = candidates;

  if (isLingerMobility(input.segment.mobility)) {
    if (shouldPauseLinger(input.npc.id, input.gameMinute)) {
      return fallback;
    }
    const nearby = candidates.filter(
      (c) => chebyshev(input.npc.x, input.npc.y, c.x, c.y) <= LINGER_RADIUS,
    );
    if (nearby.length === 0) {
      return fallback;
    }
    pool = nearby;
  }
  const nearPlayer =
    input.playerCells.length > 0 &&
    input.playerCells.some(
      (p) => chebyshev(input.npc.x, input.npc.y, p.x, p.y) <= SOCIAL_BIAS_DISTANCE,
    );

  if (
    nearPlayer &&
    input.segment.mobility === "wander" &&
    SOCIAL_BIAS_ACTIVITIES.has(input.segment.activityKey)
  ) {
    const biased: GridCell[] = [];
    for (const player of input.playerCells) {
      for (const c of candidates) {
        if (chebyshev(c.x, c.y, player.x, player.y) === 1) {
          biased.push(c);
        }
      }
    }
    if (biased.length > 0) pool = biased;
  }

  const filtered = pool.filter(
    (c) => !input.recentCells.some((r) => r.x === c.x && r.y === c.y),
  );
  const pickFrom = filtered.length > 0 ? filtered : pool;
  const chosen = pickFrom[Math.floor(Math.random() * pickFrom.length)]!;

  return {
    targetGx: chosen.x,
    targetGy: chosen.y,
    nextRecent: pushRecent(input.recentCells, chosen),
  };
}
