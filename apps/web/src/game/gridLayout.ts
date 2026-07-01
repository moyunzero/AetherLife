/** Screen pixels per logic cell — 16×2 integer scale (Phase 13.3). */
export const CELL_PX = 32;

/** Phaser viewport size in cells (camera follows player in global coords). */
export const VIEWPORT_CELLS = 12;

export function worldSize(width: number, height: number): { w: number; h: number } {
  return { w: width * CELL_PX, h: height * CELL_PX };
}

export function gridToWorld(x: number, y: number): { wx: number; wy: number } {
  return {
    wx: x * CELL_PX + CELL_PX / 2,
    wy: y * CELL_PX + CELL_PX / 2,
  };
}

export function worldToGrid(wx: number, wy: number): { x: number; y: number } {
  return {
    x: Math.floor(wx / CELL_PX),
    y: Math.floor(wy / CELL_PX),
  };
}
