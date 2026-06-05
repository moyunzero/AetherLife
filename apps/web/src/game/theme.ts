/** Phaser 0xRRGGBB tokens — aligned with apps/web/src/index.css */
export const theme = {
  bgDeep: 0x0f0e0c,
  floorWalkable: 0x1a1814,
  floorBlocked: 0x252219,
  gridLine: 0x2e2a22,
  accent: 0xc9a227,
  accentDim: 0xc9a227,
  playerOther: 0x9a9284,
  npcTint: 0x8a7d5c,
  /** Door fill — matches MovementPanel `.movement-cell--door` background (not accent fill). */
  doorFill: 0x0f0e0c,
  doorClosed: 0xc9a227,
  doorOpen: 0x6b8f5e,
  destructive: 0xb54a4a,
} as const;

export function cssHexToPhaser(hex: string): number {
  const n = parseInt(hex.replace("#", ""), 16);
  return Number.isFinite(n) ? n : 0xffffff;
}
