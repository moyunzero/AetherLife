/** SpriteFusion homestead map covers this many world grid cells (3× 16px tiles per cell). */
export const HOME_MAP_TILE_W = 24;
export const HOME_MAP_TILE_H = 24;

/** True when (gx, gy) lies inside the map-test homestead background bounds. */
export function isHomeMapRegionCell(gx: number, gy: number): boolean {
  return gx >= 0 && gx < HOME_MAP_TILE_W && gy >= 0 && gy < HOME_MAP_TILE_H;
}
