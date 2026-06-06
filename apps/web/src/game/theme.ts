import type { BiomeId } from "@aetherlife/shared";

export type BiomeFloorColors = { walkable: number; blocked: number };

/** Phaser 0xRRGGBB tokens — aligned with apps/web/src/index.css */
export const theme = {
  bgDeep: 0x0f0e0c,
  floorWalkable: 0x1a1814,
  floorBlocked: 0x252219,
  gridLine: 0x2e2a22,
  biomeVoid: { walkable: 0x121110, blocked: 0x1a1816 } satisfies BiomeFloorColors,
  biomeColors: {
    home: { walkable: 0x1a1814, blocked: 0x252219 },
    meadow: { walkable: 0x1c2418, blocked: 0x2a3324 },
    scrub: { walkable: 0x242018, blocked: 0x352e22 },
    wetland: { walkable: 0x182220, blocked: 0x24302c },
    highland: { walkable: 0x201e1a, blocked: 0x302c26 },
  } satisfies Record<BiomeId, BiomeFloorColors>,
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
