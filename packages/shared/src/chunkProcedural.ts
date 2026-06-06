import { createNoise2D } from "simplex-noise";
import type { BiomeId, ChunkBase, ChunkBaseTile } from "./chunk.js";
import { CHUNK_SIZE, globalCell } from "./world.js";

export type BiomeTile = {
  biome: BiomeId;
  walkable: boolean;
};

/** Map simplex noise sample [-1,1] to biome + walkable. */
export function biomeFromNoise(n: number, detail: number): BiomeTile {
  if (n < -0.45) {
    return { biome: "wetland", walkable: detail > -0.2 };
  }
  if (n < -0.15) {
    return { biome: "scrub", walkable: true };
  }
  if (n < 0.35) {
    return { biome: "meadow", walkable: true };
  }
  return { biome: "highland", walkable: detail > 0.1 };
}

/** Home chunk (0,0) — entire 8×8 uses home biome; terrain always walkable. */
export function homeChunkTile(): BiomeTile {
  return { biome: "home", walkable: true };
}

/** Deterministic PRNG for simplex-noise seeding. */
function alea(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createWorldNoise2D(worldSeed: number) {
  return createNoise2D(alea(worldSeed));
}

/** Deterministic procedural base for one chunk. */
export function generateChunkBase(cx: number, cy: number, worldSeed: number): ChunkBase {
  const noise2D = createWorldNoise2D(worldSeed);
  const detail2D = createNoise2D(alea(worldSeed ^ 0x9e3779b9));
  const tiles: ChunkBaseTile[] = [];

  for (let ly = 0; ly < CHUNK_SIZE; ly++) {
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      if (cx === 0 && cy === 0) {
        tiles.push({ lx, ly, ...homeChunkTile() });
        continue;
      }
      const { gx, gy } = globalCell(cx, cy, lx, ly);
      const n = noise2D(gx * 0.07, gy * 0.07);
      const detail = detail2D(gx * 0.19 + 100, gy * 0.19 + 100);
      const { biome, walkable } = biomeFromNoise(n, detail);
      tiles.push({ lx, ly, biome, walkable });
    }
  }

  return { cx, cy, tiles };
}

/** Lookup biome at global cell (client prediction fallback / tests). */
export function biomeAtGlobal(
  gx: number,
  gy: number,
  worldSeed: number,
): { biome: BiomeId; walkable: boolean } {
  const cx = Math.floor(gx / CHUNK_SIZE);
  const cy = Math.floor(gy / CHUNK_SIZE);
  const lx = ((gx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
  const ly = ((gy % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
  const base = generateChunkBase(cx, cy, worldSeed);
  const tile = base.tiles.find((t) => t.lx === lx && t.ly === ly);
  if (!tile) return { biome: "meadow", walkable: true };
  return { biome: tile.biome, walkable: tile.walkable };
}
