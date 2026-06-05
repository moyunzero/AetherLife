import { CELL_PX } from "./gridLayout.js";

/**
 * Phaser top-down 2D marker layout — disc + label above, not HTML grid cells.
 */
export { CELL_PX };

/** Disc radius (fits inside 40px cell with label above). */
export const MARKER_RADIUS = 12;

/** Disc center — container origin = cell center (gridToWorld). */
export const MARKER_CY = 0;

/** Label baseline above disc center. */
export const MARKER_LABEL_Y = -(MARKER_RADIUS + 6);

export const MARKER_STROKE = 2;

export const MARKER_LABEL_MAX_WIDTH = 36;
