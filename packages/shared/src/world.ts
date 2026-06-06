/** Cells per chunk edge — matches legacy RoomState 8×8. */
export const CHUNK_SIZE = 8;

export function chunkOf(gx: number, gy: number): { cx: number; cy: number } {
  return {
    cx: Math.floor(gx / CHUNK_SIZE),
    cy: Math.floor(gy / CHUNK_SIZE),
  };
}

/** Euclidean modulo for local cell within chunk (handles negative global coords). */
export function floorMod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

export function localInChunk(gx: number, gy: number): { lx: number; ly: number } {
  return {
    lx: floorMod(gx, CHUNK_SIZE),
    ly: floorMod(gy, CHUNK_SIZE),
  };
}

export function globalCell(cx: number, cy: number, lx: number, ly: number): { gx: number; gy: number } {
  return {
    gx: cx * CHUNK_SIZE + lx,
    gy: cy * CHUNK_SIZE + ly,
  };
}

export function chunkKey(cx: number, cy: number): string {
  return `${cx},${cy}`;
}
