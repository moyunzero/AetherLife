import type { BiomeId } from "@aetherlife/shared";

/**
 * Phase 13.2 — runtime pastoral color (D-tint).
 * Applied in Phaser via setTint on floor layer tiles + decor sprites only.
 * Do not bake into PNG import scripts.
 */

/** Default warm lift for home / meadow pastoral tiles. */
export const FLOOR_LAYER_TINT = 0xfff4e8;

/** Homestead decor (well, fence, tree) — slightly warmer than floor. */
export const DECOR_TINT = 0xfff5e6;

/** Wetland water/mud — soft pastoral green, not roguelike cyan (D-wetland-tone). */
export const WETLAND_FLOOR_TINT = 0xd4e6c4;

export const WETLAND_DECOR_TINT = 0xc8ddb8;

const BIOME_FLOOR_TINT: Record<BiomeId, number> = {
  home: 0xfff4e8,
  meadow: 0xf2f8e6,
  scrub: 0xf5eed8,
  wetland: WETLAND_FLOOR_TINT,
  highland: 0xeae6dc,
};

/** Per-biome floor tint after tile paint — keeps AE-04 biome separation. */
export function tintForBiome(biome: BiomeId): number {
  return BIOME_FLOOR_TINT[biome];
}

/** Decor tint: homestead chunk warmer; wetland reeds softened. */
export function decorTintForPlacement(
  biome: BiomeId | undefined,
  chunkCx: number,
  chunkCy: number,
): number {
  if (biome === "wetland") return WETLAND_DECOR_TINT;
  if (chunkCx === 0 && chunkCy === 0) return DECOR_TINT;
  return FLOOR_LAYER_TINT;
}
