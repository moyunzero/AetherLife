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

/**
 * Clears the module's internal registry of baked region collision grids, resetting walkability state for tests.
 */
export function resetRegionWalkabilityForTests(): void {
  gridsByRegionId.clear();
}

/**
 * Register a baked collision grid for a region.
 *
 * @param regionId - The world region identifier to register the grid under
 * @param grid - The collision grid; `cells` is a row-major array where `0` denotes walkable and non-zero denotes blocked
 * @param expectedSize - Optional expected dimensions `{ w, h }`; when provided, the grid's width and height are validated against these values
 * @throws Error if `grid.cells.length` does not equal `grid.width * grid.height`, or if `expectedSize` is provided and the grid dimensions do not match
 */
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

/**
 * Retrieve the baked collision grid for a region by its id.
 *
 * @param regionId - The region identifier to look up
 * @returns The registered `RegionCollisionGrid` for `regionId`, or `undefined` if no grid is registered
 */
export function getRegionCollision(regionId: WorldRegionId): RegionCollisionGrid | undefined {
  return gridsByRegionId.get(regionId);
}

/**
 * Determine whether a global map cell is walkable using a region's baked collision grid.
 *
 * @returns `true` if the cell is walkable, `false` if the cell is blocked, or `undefined` if the coordinates are outside any registered region or the region has no collision data
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

/**
 * Determine walkability of terrain at global coordinates within a region that has a baked collision grid.
 *
 * @param gx - Global X coordinate
 * @param gy - Global Y coordinate
 * @returns `true` if the tile at `(gx, gy)` is walkable, `false` if it is blocked, or `undefined` if the point is outside any region with registered collision data or the collision data is missing/invalid
 */
export function isTerrainWalkableInRegion(gx: number, gy: number): boolean | undefined {
  return regionWalkabilityAt(gx, gy);
}

/**
 * Registers the baked collision grid for the "Beginning Fields" region.
 *
 * If the region's size is available, it is passed as the expected size when registering.
 *
 * @param raw - The baked region collision grid (row-major `cells` where `0` is walkable and `1` is blocked)
 */
export function bootBeginningFieldsCollision(raw: RegionCollisionGrid): void {
  const region = getRegionById(BEGINNING_FIELDS_ID);
  registerRegionCollision(BEGINNING_FIELDS_ID, raw, region?.size);
}
