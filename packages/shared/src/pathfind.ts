import type { RoomState } from "./room.js";

export type GridCell = { x: number; y: number };

export type MoveGrid = {
  width: number;
  height: number;
  isBlocked: (x: number, y: number) => boolean;
};

export type BuildMoveGridOptions = {
  /** NPC id to omit from blocked cells (pathfinding / move validation for that NPC). */
  excludeNpcId?: string;
};

function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

/** Walkability: other NPCs, all map objects, and other player positions. */
export function buildMoveGrid(
  map: RoomState,
  otherPlayerCells: readonly GridCell[],
  options?: BuildMoveGridOptions,
): MoveGrid {
  const blocked = new Set<string>();
  for (const npc of map.npcs) {
    if (options?.excludeNpcId === npc.id) continue;
    blocked.add(cellKey(npc.x, npc.y));
  }
  for (const obj of map.objects) {
    blocked.add(cellKey(obj.x, obj.y));
  }
  for (const p of otherPlayerCells) {
    blocked.add(cellKey(p.x, p.y));
  }
  return {
    width: map.width,
    height: map.height,
    isBlocked: (x, y) => blocked.has(cellKey(x, y)),
  };
}

/** Whether a single grid step into (toX, toY) is allowed (players / NPCs / objects). */
export function canStepTo(
  map: RoomState,
  toX: number,
  toY: number,
  otherPlayerCells: readonly GridCell[],
): boolean {
  const grid = buildMoveGrid(map, otherPlayerCells);
  if (toX < 0 || toY < 0 || toX >= grid.width || toY >= grid.height) {
    return false;
  }
  return !grid.isBlocked(toX, toY);
}

/** BFS from (fromX, fromY) for the nearest cell that is not blocked. */
export function findNearestWalkableCell(
  map: RoomState,
  fromX: number,
  fromY: number,
  otherPlayerCells: readonly GridCell[],
  options?: BuildMoveGridOptions,
): GridCell {
  const grid = buildMoveGrid(map, otherPlayerCells, options);
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

  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const [ddx, ddy] of dirs) {
      const nx = cur.x + ddx;
      const ny = cur.y + ddy;
      if (nx < 0 || ny < 0 || nx >= grid.width || ny >= grid.height) continue;
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

function inBounds(x: number, y: number, grid: MoveGrid): boolean {
  return x >= 0 && y >= 0 && x < grid.width && y < grid.height;
}

/** 4-direction BFS; cells from start through goal (inclusive). */
export function findGridPath(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  grid: MoveGrid,
): GridCell[] | null {
  if (!inBounds(fromX, fromY, grid) || !inBounds(toX, toY, grid)) {
    return null;
  }
  if (fromX === toX && fromY === toY) {
    return [{ x: fromX, y: fromY }];
  }
  if (grid.isBlocked(toX, toY)) {
    return null;
  }

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

  while (queue.length > 0) {
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
      if (!inBounds(nx, ny, grid)) continue;
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
