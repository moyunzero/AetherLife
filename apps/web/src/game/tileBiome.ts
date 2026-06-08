import type { BiomeId } from "@aetherlife/shared";

/** Tiles per biome row in biomes.png (4 walk + blocked + shore). */
export const TILES_PER_BIOME = 6;
export const WALK_VARIANT_COUNT = 4;

const BIOME_ORDER: BiomeId[] = ["home", "meadow", "scrub", "wetland", "highland"];

export function biomeBaseIndex(biome: BiomeId): number {
  const row = BIOME_ORDER.indexOf(biome);
  return row * TILES_PER_BIOME;
}

/** Deterministic floor variant 0..3 from world cell (D-03). */
export function pickFloorVariant(gx: number, gy: number): number {
  return Math.abs((gx * 73856093) ^ (gy * 19349663)) % WALK_VARIANT_COUNT;
}

export function tileIndexFor(
  biome: BiomeId,
  walkable: boolean,
  gx: number,
  gy: number,
): number {
  const base = biomeBaseIndex(biome);
  if (!walkable) return base + 4;
  return base + pickFloorVariant(gx, gy);
}

/** Wetland shore tile index (D-06). */
export function shoreIndexFor(biome: BiomeId): number {
  return biomeBaseIndex(biome) + 5;
}

export function isWetlandShoreCell(
  biome: BiomeId,
  walkable: boolean,
  neighborBiome: BiomeId | null,
): boolean {
  return (
    biome === "wetland"
    && walkable
    && neighborBiome != null
    && neighborBiome !== "wetland"
  );
}

/** Dark textured tile for cells outside loaded chunk data (matches letterbox void). */
export function voidTileIndexFor(gx: number, gy: number): number {
  const biome: BiomeId = pickFloorVariant(gx, gy) % 2 === 0 ? "highland" : "scrub";
  return tileIndexFor(biome, false, gx, gy);
}
