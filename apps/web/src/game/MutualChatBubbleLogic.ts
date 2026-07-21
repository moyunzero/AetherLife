/** Pure mutual-chat bubble helpers (no Phaser) — D-MUTUAL-02. */

export const MUTUAL_BUBBLE_MAX_CHARS = 20;
export const MUTUAL_BUBBLE_HOLD_MS = 3500;
export const MUTUAL_BUBBLE_FADE_MS = 400;
export const MUTUAL_BUBBLE_REDUCED_HIDE_MS = 4000;

const PROXIMITY_CELLS = 2;
const CONTROL_CHARS = /[\x00-\x1f\x7f]/g;

export function truncateMutualBubbleText(text: string): string {
  const cleaned = String(text ?? "").replace(CONTROL_CHARS, "").trim();
  if (cleaned.length <= MUTUAL_BUBBLE_MAX_CHARS) return cleaned;
  return cleaned.slice(0, MUTUAL_BUBBLE_MAX_CHARS);
}

function chebyshevDistance(ax: number, ay: number, bx: number, by: number): number {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

/** Player Chebyshev ≤2 — same proximity band as activity / nameplates. */
export function shouldShowMutualChatBubble(
  gx: number,
  gy: number,
  localGx: number,
  localGy: number,
): boolean {
  return chebyshevDistance(gx, gy, localGx, localGy) <= PROXIMITY_CELLS;
}
