import { CELL_PX } from "./gridLayout.js";

/**
 * Phaser top-down 2D marker layout — disc + label above, not HTML grid cells.
 */
export { CELL_PX };

/** Disc radius (fits inside 48px cell with label above). */
export const MARKER_RADIUS = 14;

/** Disc center — container origin = cell center (gridToWorld). */
export const MARKER_CY = 0;

/** Label baseline above disc center. */
export const MARKER_LABEL_Y = -(MARKER_RADIUS + 6);

export const MARKER_STROKE = 2;

export const MARKER_LABEL_MAX_WIDTH = 44;

/** Floor/path layers use 0–2; entities sit above via this baseline. */
export const ENTITY_DEPTH_BASE = 10_000;

/**
 * Y-sort depth for grid entities. Baseline keeps depth positive when `gy < 0` (explore north).
 */
export function entityDepth(gx: number, gy: number, layer: 0 | 1 | 2 = 1): number {
  return ENTITY_DEPTH_BASE + gy * 10 + gx + layer;
}
