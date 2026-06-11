import {
  BEGINNING_FIELDS_ID,
  fromLocal,
  getRegionById,
  regionAt,
  type WorldRegionId,
} from "@aetherlife/shared";

/** Baked collision grid: 0 = walkable, 1 = blocked (flat row-major). */
export type RegionCollisionGrid = {
  width: number;
  height: number;
  cells: number[];
};

const gridsByRegionId = new Map<WorldRegionId, RegionCollisionGrid>();

export function resetRegionWalkabilityForTests(): void {
  gridsByRegionId.clear();
}

export function registerRegionCollision(
  regionId: WorldRegionId,
  grid: RegionCollisionGrid,
  expectedSize?: { w: number; h: number },
): void {
  const expectedCells = grid.width * grid.height;
  if (grid.cells.length !== expectedCells) {
    throw new Error(
      `collision grid for ${regionId}: cells.length ${grid.cells.length} !== ${expectedCells}`,
    );
  }
  if (expectedSize) {
    if (grid.width !== expectedSize.w || grid.height !== expectedSize.h) {
      throw new Error(
        `collision grid for ${regionId}: dimensions ${grid.width}x${grid.height} !== registry ${expectedSize.w}x${expectedSize.h}`,
      );
    }
  }
  gridsByRegionId.set(regionId, grid);
}

export function getRegionCollision(regionId: WorldRegionId): RegionCollisionGrid | undefined {
  return gridsByRegionId.get(regionId);
}

/**
 * Walkability for a global cell inside a registered region with baked collision.
 * @returns `true`/`false` when region has collision data; `undefined` when outside or no bake.
 */
export function regionWalkabilityAt(gx: number, gy: number): boolean | undefined {
  const region = regionAt(gx, gy);
  if (!region) return undefined;

  const grid = gridsByRegionId.get(region.id);
  if (!grid) return undefined;

  const local = fromLocal(region, gx, gy);
  if (!local) return undefined;

  const idx = local.ly * grid.width + local.lx;
  const cell = grid.cells[idx];
  if (cell === undefined) return undefined;
  return cell === 0;
}

/** True when terrain is walkable at (gx, gy) for registered regions with collision bake. */
export function isTerrainWalkableInRegion(gx: number, gy: number): boolean | undefined {
  return regionWalkabilityAt(gx, gy);
}

export function bootBeginningFieldsCollision(raw: RegionCollisionGrid): void {
  const region = getRegionById(BEGINNING_FIELDS_ID);
  registerRegionCollision(BEGINNING_FIELDS_ID, raw, region?.size);
}
