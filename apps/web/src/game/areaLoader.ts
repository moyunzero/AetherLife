import type { BiomeId, ChunkView } from "@aetherlife/shared";
import type * as Phaser from "phaser";
import {
  type AreaPackId,
  type AssetSheetDef,
  BIOME_PACK_IDS,
  CORE_AREA_ASSETS,
  LAZY_BIOME_PACK_ASSETS,
} from "./assetManifest.js";
import { isVisualFallbackActive } from "./visualFallback.js";

const queuedKeys = new WeakMap<Phaser.Scene, Set<string>>();

function pendingKeys(scene: Phaser.Scene): Set<string> {
  let set = queuedKeys.get(scene);
  if (!set) {
    set = new Set();
    queuedKeys.set(scene, set);
  }
  return set;
}

function queueAsset(loader: Phaser.Loader.LoaderPlugin, def: AssetSheetDef): void {
  const scene = loader.scene;
  if (scene.textures.exists(def.key)) return;
  if (pendingKeys(scene).has(def.key)) return;
  pendingKeys(scene).add(def.key);

  if (def.kind === "spritesheet") {
    loader.spritesheet(def.key, def.url, {
      frameWidth: def.frameWidth,
      frameHeight: def.frameHeight,
    });
  } else {
    loader.image(def.key, def.url);
  }
}

/** Load home + meadow + player atlases during Scene preload. */
export function loadCoreAreaPack(loader: Phaser.Loader.LoaderPlugin): void {
  for (const def of CORE_AREA_ASSETS) {
    queueAsset(loader, def);
  }
}

/** Plan alias — core area pack for preload. */
export const loadAreaPack = loadCoreAreaPack;

function lazyPackForBiome(biome: BiomeId): Exclude<AreaPackId, "core"> | null {
  const pack = BIOME_PACK_IDS[biome];
  return pack === "core" ? null : pack;
}

/** Queue scrub/wetland/highland packs without blocking the game loop (D-20). */
export function preloadAdjacentBiomes(scene: Phaser.Scene, biomes: Iterable<BiomeId>): void {
  if (isVisualFallbackActive(scene)) return;

  const loader = scene.load;
  const before = pendingKeys(scene).size;

  for (const biome of biomes) {
    const packId = lazyPackForBiome(biome);
    if (!packId) continue;
    queueAsset(loader, LAZY_BIOME_PACK_ASSETS[packId]);
  }

  if (pendingKeys(scene).size > before && !loader.isLoading()) {
    loader.start();
  }
}

/** Collect biomes from loaded chunks for lazy preload. */
export function biomesFromChunks(chunks: ChunkView[]): Set<BiomeId> {
  const set = new Set<BiomeId>();
  for (const chunk of chunks) {
    for (const tile of chunk.tiles) {
      set.add(tile.biome);
    }
  }
  return set;
}
