import type { GameObject } from "./room.js";

/** Procedural / anchor biome ids (Phase 10). */
export type BiomeId = "home" | "meadow" | "scrub" | "wetland" | "highland";

export type ChunkBaseTile = {
  lx: number;
  ly: number;
  biome: BiomeId;
  walkable: boolean;
};

export type ChunkBase = {
  cx: number;
  cy: number;
  tiles: ChunkBaseTile[];
};

export type ChunkTileView = {
  lx: number;
  ly: number;
  biome: BiomeId;
  walkable: boolean;
};

export type ChunkView = {
  cx: number;
  cy: number;
  tiles: ChunkTileView[];
};

/** Stable fingerprint of loaded chunk coordinates (for deduping sync). */
export function chunkViewsFingerprint(chunks: Array<{ cx: number; cy: number }>): string {
  if (chunks.length === 0) return "";
  return chunks
    .map((c) => `${c.cx},${c.cy}`)
    .sort()
    .join("|");
}

export type ChunkDelta = {
  tiles?: Array<{ lx: number; ly: number; walkable?: boolean; biome?: BiomeId }>;
  objects?: GameObject[];
};

export const BIOME_LABEL_ZH: Record<BiomeId, string> = {
  home: "家园",
  meadow: "草甸",
  scrub: "灌丛",
  wetland: "湿地",
  highland: "高地",
};
