import { CELL_PX } from "./gridLayout.js";

/**
 * Phaser top-down 2D marker layout — disc + label above, not HTML grid cells.
 */
export { CELL_PX };

/** On-screen character height — two logic cells (feet anchor unchanged). */
export const CHAR_DISPLAY_PX = CELL_PX * 2;

/** Typography / marker scale vs Phase 13 UAT baseline (@ CELL_PX=48). */
export const LABEL_SCALE = CELL_PX / 48;

/** Minimum glyph sizes for legible Han labels on small grids. */
export const LABEL_MIN_NAMEPLATE_PX = 10;
export const LABEL_MIN_ACTIVITY_PX = 9;

export function labelPx(base: number, minPx = 8): string {
  return `${Math.max(minPx, Math.round(base * LABEL_SCALE))}px`;
}

export function nameplateFontPx(): number {
  return Math.max(LABEL_MIN_NAMEPLATE_PX, Math.round(12 * LABEL_SCALE));
}

export function activityFontPx(): number {
  return Math.max(LABEL_MIN_ACTIVITY_PX, Math.round(10 * LABEL_SCALE));
}

export function intentFontPx(): number {
  return Math.max(LABEL_MIN_ACTIVITY_PX, Math.round(8 * LABEL_SCALE));
}

export function labelOffset(base: number): number {
  return Math.max(2, Math.round(base * LABEL_SCALE));
}

/** Disc radius (fits inside cell with label above). */
export const MARKER_RADIUS = labelOffset(14);

/** Disc center — container origin = cell center (gridToWorld). */
export const MARKER_CY = 0;

/** Label baseline above disc center. */
export const MARKER_LABEL_Y = -(MARKER_RADIUS + labelOffset(6));

export const MARKER_STROKE = 2;

export const MARKER_LABEL_MAX_WIDTH = labelOffset(44);

/** Tiled tile bands (Ground … Water) — sequential depth in map layer order. */
export const MAP_TILE_DEPTH_BASE = 0;
export const MAP_TILE_DEPTH_STEP = 0.01;

/** Floor/tile layers use depth below this; entities & Tiled objects sit above. */
export const ENTITY_DEPTH_BASE = 10_000;

/** Future Tiled Overhead layer — fixed above all Y-sorted sprites (canopy, roofs). */
export const YSORT_OVERHEAD_DEPTH = 50_000;

export type YSortLayer = 0 | 1 | 2;

/** Sub-layer at the same foot Y (shadow/decor < object/npc < player). */
export const YSORT_LAYER = {
  SHADOW: 0,
  DECOR: 0,
  OBJECT: 1,
  NPC: 1,
  PLAYER: 2,
} as const;

const Y_SORT_Y_WEIGHT = 10;
const Y_SORT_X_WEIGHT = 0.01;

/**
 * Phaser depth from a world-space foot/sort point — Tiled `draworder: topdown` semantics.
 * Y dominates (larger sort Y = south = drawn in front); X breaks ties west → east.
 */
export function ySortDepth(
  sortWorldX: number,
  sortWorldY: number,
  layer: YSortLayer = YSORT_LAYER.OBJECT,
): number {
  const gy = sortWorldY / CELL_PX;
  const gx = sortWorldX / CELL_PX;
  return ENTITY_DEPTH_BASE + gy * Y_SORT_Y_WEIGHT + gx * Y_SORT_X_WEIGHT + layer;
}

/**
 * Grid entity foot — cell center X, south cell edge Y (matches {@link entitySprites} foot anchor).
 */
export function entityFootSortPoint(gx: number, gy: number): { x: number; y: number } {
  return {
    x: gx * CELL_PX + CELL_PX / 2,
    y: (gy + 1) * CELL_PX,
  };
}

/** Y-sort depth for players/NPCs/disc markers on the logic grid. */
export function entityYSortDepth(
  gx: number,
  gy: number,
  layer: YSortLayer = YSORT_LAYER.NPC,
): number {
  const foot = entityFootSortPoint(gx, gy);
  return ySortDepth(foot.x, foot.y, layer);
}

/** Y-sort while tweening — container origin is cell center, not foot. */
export function entityYSortDepthFromCenter(
  worldCenterX: number,
  worldCenterY: number,
  layer: YSortLayer,
): number {
  return ySortDepth(worldCenterX, worldCenterY + CELL_PX / 2, layer);
}

/**
 * Tiled tile object — bottom-left anchor in world px (map coord × {@link HomeMapBackground} TILE_SCALE).
 */
export function tiledObjectYSortDepth(
  bottomLeftWorldX: number,
  bottomLeftWorldY: number,
  layer: YSortLayer = YSORT_LAYER.OBJECT,
): number {
  return ySortDepth(bottomLeftWorldX, bottomLeftWorldY, layer);
}
