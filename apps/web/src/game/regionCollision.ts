import {
  BEGINNING_FIELDS_ID,
  VILLAGE_PLAZA_ID,
  fromLocal,
  regionAt,
  type WorldRegionId,
} from "@aetherlife/shared";
import beginningFieldsCollision from "../../public/world/beginning-fields/collision.json";
import villagePlazaCollision from "../../public/world/village-plaza/collision.json";

/** Baked collision grid: 0 = walkable, 1 = blocked (flat row-major). */
export type RegionCollisionGrid = {
  width: number;
  height: number;
  cells: number[];
  source?: string;
};

const gridsByRegionId = new Map<WorldRegionId, RegionCollisionGrid>([
  [BEGINNING_FIELDS_ID, beginningFieldsCollision as RegionCollisionGrid],
  [VILLAGE_PLAZA_ID, villagePlazaCollision as RegionCollisionGrid],
]);

/**
 * Determine whether a global grid cell at the given coordinates is walkable using a region's baked collision.
 *
 * @param gx - Global x (column) cell coordinate
 * @param gy - Global y (row) cell coordinate
 * @returns `true` if the cell is walkable (cell value `0`), `false` if blocked (cell value `1`), or `undefined` if the coordinates are outside any registered region, the region has no baked collision grid, or the cell is missing
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
