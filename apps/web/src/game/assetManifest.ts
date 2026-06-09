import type { BiomeId } from "@aetherlife/shared";

/** Source cell size for tile/sprite atlases (UI-SPEC). */
export const TILE_PX = 16;

/** Character/NPC spritesheet frame size — Stardew-style 1×2 cells (Phase 13.3). */
export const CHAR_FRAME_W = 16;
export const CHAR_FRAME_H = 32;

/** Walk + idle frames per facing (13-03). */
export const FRAMES_PER_FACING = 6;
export const WALK_FRAMES = 4;
export const IDLE_FRAMES = 2;
export const FACING_COUNT = 4;
export const PALETTE_ROW_COUNT = 4;
/** Distinct NPC silhouettes in npcs.png (2 rows per variant × 4 facings). */
export const NPC_VARIANT_COUNT = 2;

export type AreaPackId = "core" | "scrub" | "wetland" | "highland";

export type AssetSheetDef =
  | { kind: "image"; key: string; url: string }
  | {
      kind: "spritesheet";
      key: string;
      url: string;
      frameWidth: number;
      frameHeight: number;
    };

/** @deprecated Use tileBiome.ts — 6 tiles per biome row in atlas. */
export const BIOME_TILE_INDEX: Record<BiomeId, { walkable: number; blocked: number }> = {
  home: { walkable: 0, blocked: 4 },
  meadow: { walkable: 6, blocked: 10 },
  scrub: { walkable: 12, blocked: 16 },
  wetland: { walkable: 18, blocked: 22 },
  highland: { walkable: 24, blocked: 28 },
};

export const ASSET_KEYS = {
  tilesBiomes: "tiles/biomes",
  tilesDecor: "tiles/decor",
  spritesCharacters: "sprites/characters",
  spritesNpcs: "sprites/npcs",
  spritesUiSpeech: "sprites/ui-speech",
  tilesScrubPack: "tiles/biome-scrub",
  tilesWetlandPack: "tiles/biome-wetland",
  tilesHighlandPack: "tiles/biome-highland",
  /** SpriteFusion Tiled export — initial homestead background */
  mapTestHome: "map-test/home",
  mapTestTiles: "map-test/spritefusion",
} as const;

export const BASE = "/assets";

export const CORE_AREA_ASSETS: AssetSheetDef[] = [
  { kind: "image", key: ASSET_KEYS.tilesBiomes, url: `${BASE}/tiles/biomes.png` },
  {
    kind: "spritesheet",
    key: ASSET_KEYS.tilesDecor,
    url: `${BASE}/tiles/decor.png`,
    frameWidth: TILE_PX,
    frameHeight: TILE_PX,
  },
  {
    kind: "spritesheet",
    key: ASSET_KEYS.spritesCharacters,
    url: `${BASE}/sprites/characters.png`,
    frameWidth: CHAR_FRAME_W,
    frameHeight: CHAR_FRAME_H,
  },
  {
    kind: "spritesheet",
    key: ASSET_KEYS.spritesNpcs,
    url: `${BASE}/sprites/npcs.png`,
    frameWidth: CHAR_FRAME_W,
    frameHeight: CHAR_FRAME_H,
  },
  { kind: "image", key: ASSET_KEYS.spritesUiSpeech, url: `${BASE}/sprites/ui-speech.png` },
];

/** Lazy packs loaded on chunk cross (D-20). */
export const LAZY_BIOME_PACK_ASSETS: Record<
  Exclude<AreaPackId, "core">,
  AssetSheetDef
> = {
  scrub: { kind: "image", key: ASSET_KEYS.tilesScrubPack, url: `${BASE}/tiles/biome-scrub.png` },
  wetland: {
    kind: "image",
    key: ASSET_KEYS.tilesWetlandPack,
    url: `${BASE}/tiles/biome-wetland.png`,
  },
  highland: {
    kind: "image",
    key: ASSET_KEYS.tilesHighlandPack,
    url: `${BASE}/tiles/biome-highland.png`,
  },
};

export const BIOME_PACK_IDS: Record<BiomeId, AreaPackId> = {
  home: "core",
  meadow: "core",
  scrub: "scrub",
  wetland: "wetland",
  highland: "highland",
};

/** Core pack = home + meadow + player sheets (loaded in preload). */
export const CORE_AREA_PACK = CORE_AREA_ASSETS;

/** Frame index for character sheet: row = palette, col = dir*6 + frame. */
export function characterFrameIndex(
  paletteRow: number,
  facingIndex: number,
  frameInFacing: number,
): number {
  return paletteRow * FACING_COUNT * FRAMES_PER_FACING + facingIndex * FRAMES_PER_FACING + frameInFacing;
}

/** npcs.png — NPC_VARIANT_COUNT × 4 facing rows × 6 frames (16×32). */
export function npcFrameIndex(
  variant: number,
  facingIndex: number,
  frameInFacing: number,
): number {
  return (
    variant * FACING_COUNT * FRAMES_PER_FACING +
    facingIndex * FRAMES_PER_FACING +
    frameInFacing
  );
}
