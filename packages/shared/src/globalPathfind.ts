import { HOME_DEFAULT_PLAYER_SPAWN, homeDefaultPlayerSpawn } from "./homeMap.js";
import type { GridCell } from "./pathfind.js";
import type { RoomState } from "./room.js";
import { chunkOf } from "./world.js";

function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

export type GlobalMoveGrid = {
  isTerrainWalkable: (gx: number, gy: number) => boolean;
  isBlocked: (gx: number, gy: number) => boolean;
};

export type BuildGlobalMoveGridOptions = {
  excludeNpcId?: string;
  /** Homestead map snapshot (0..HOME_MAP_TILE_W/H-1). */
  homeMap: RoomState;
  otherPlayerCells: readonly GridCell[];
  isTerrainWalkable: (gx: number, gy: number) => boolean;
};

export function buildGlobalMoveGrid(options: BuildGlobalMoveGridOptions): GlobalMoveGrid {
  const blocked = new Set<string>();
  const { homeMap, otherPlayerCells, isTerrainWalkable } = options;

  for (const npc of homeMap.npcs) {
    if (options.excludeNpcId === npc.id) continue;
    blocked.add(cellKey(npc.x, npc.y));
  }
  for (const obj of homeMap.objects) {
    if (obj.kind === "door" && obj.state === "open") continue;
    blocked.add(cellKey(obj.x, obj.y));
  }
  for (const p of otherPlayerCells) {
    blocked.add(cellKey(p.x, p.y));
  }

  return {
    isTerrainWalkable,
    isBlocked: (gx, gy) => {
      if (!isTerrainWalkable(gx, gy)) return true;
      return blocked.has(cellKey(gx, gy));
    },
  };
}

export function canStepGlobal(
  gx: number,
  gy: number,
  grid: GlobalMoveGrid,
): boolean {
  return !grid.isBlocked(gx, gy);
}

/** 4-direction BFS on global grid; only steps through walkable cells. */
export function findGlobalGridPath(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  grid: GlobalMoveGrid,
  /** Max BFS expansions (3×3 loaded chunks ≈ 576 cells; 64 was too low). */
  maxSteps = 2048,
): GridCell[] | null {
  if (fromX === toX && fromY === toY) {
    return [{ x: fromX, y: fromY }];
  }
  if (grid.isBlocked(toX, toY)) return null;

  const start = cellKey(fromX, fromY);
  const goal = cellKey(toX, toY);
  const queue: GridCell[] = [{ x: fromX, y: fromY }];
  const prev = new Map<string, string | null>();
  prev.set(start, null);
  const dirs = [
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
  ] as const;
  let steps = 0;

  while (queue.length > 0 && steps < maxSteps) {
    steps += 1;
    const cur = queue.shift()!;
    const curKey = cellKey(cur.x, cur.y);
    if (curKey === goal) {
      const path: GridCell[] = [];
      let k: string | null = goal;
      while (k) {
        const [px, py] = k.split(",").map(Number);
        path.push({ x: px, y: py });
        k = prev.get(k) ?? null;
      }
      path.reverse();
      return path;
    }
    for (const [ddx, ddy] of dirs) {
      const nx = cur.x + ddx;
      const ny = cur.y + ddy;
      const nk = cellKey(nx, ny);
      if (prev.has(nk)) continue;
      const isStart = nx === fromX && ny === fromY;
      if (!isStart && grid.isBlocked(nx, ny)) continue;
      prev.set(nk, curKey);
      queue.push({ x: nx, y: ny });
    }
  }
  return null;
}

/** Nearest walkable global cell (BFS). */
export function findNearestGlobalWalkable(
  fromX: number,
  fromY: number,
  grid: GlobalMoveGrid,
  maxRadius = 16,
): GridCell {
  if (!grid.isBlocked(fromX, fromY)) {
    return { x: fromX, y: fromY };
  }
  const start = cellKey(fromX, fromY);
  const queue: GridCell[] = [{ x: fromX, y: fromY }];
  const seen = new Set<string>([start]);
  const dirs = [
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
  ] as const;
  let steps = 0;

  while (queue.length > 0 && steps < maxRadius * maxRadius) {
    steps += 1;
    const cur = queue.shift()!;
    for (const [ddx, ddy] of dirs) {
      const nx = cur.x + ddx;
      const ny = cur.y + ddy;
      const key = cellKey(nx, ny);
      if (seen.has(key)) continue;
      seen.add(key);
      if (!grid.isBlocked(nx, ny)) {
        return { x: nx, y: ny };
      }
      queue.push({ x: nx, y: ny });
    }
  }
  return { x: fromX, y: fromY };
}

/** True when global cell lies in home chunk (0,0). */
export function isHomeChunkCell(gx: number, gy: number): boolean {
  const { cx, cy } = chunkOf(gx, gy);
  return cx === 0 && cy === 0;
}

/** Colyseus join spawn on Beginning Fields (Tiled tile = game cell). */
export function defaultSpawnGlobal(): GridCell {
  return homeDefaultPlayerSpawn();
}
