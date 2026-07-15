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
export const LINGER_PAUSE_PERCENT = 15;
/** Max walkable cells sampled per zone per tick — caps DoS from huge zone rects (T-16-02). */
export const MAX_ZONE_SAMPLE_CELLS = 256;

function shouldPauseLinger(npcId: string, gameMinute: number): boolean {
  return stableStringHash(`linger:${npcId}:${gameMinute}`) % 100 < LINGER_PAUSE_PERCENT;
}

function chebyshev(ax: number, ay: number, bx: number, by: number): number {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

function findZone(registry: WorldRegistry, zoneId: string): Zone | undefined {
  let regionId: string;
  let localId: string;
  try {
    ({ regionId, localId } = parseZoneId(zoneId as ZoneId));
  } catch {
    return undefined;
  }
  const zones = registry.zonesByRegion.get(regionId);
  return zones?.find((z) => z.localId === localId);
}

/** Hash-stable subsample when zone area exceeds MAX_ZONE_SAMPLE_CELLS. */
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
