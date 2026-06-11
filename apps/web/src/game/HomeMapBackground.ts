import { HOME_MAP_TILE_H, HOME_MAP_TILE_W, isHomeMapRegionCell } from "@aetherlife/shared";
import type * as Phaser from "phaser";
import { ASSET_KEYS, TILE_PX } from "./assetManifest.js";
import { tiledObjectYSortDepth, YSORT_LAYER } from "./entityLayout.js";
import { CELL_PX } from "./gridLayout.js";
import { isVisualFallbackActive } from "./visualFallback.js";

export { HOME_MAP_TILE_H, HOME_MAP_TILE_W, isHomeMapRegionCell as isHomeMapCell };

const TILE_SCALE = CELL_PX / TILE_PX;

/** Editor-only layer — hidden in Tiled, not shown in game. */
const SKIP_LAYER_NAMES = new Set(["RockSlopes", "Collision"]);

type TiledLayerMeta = {
  name: string;
  type: string;
  visible?: boolean;
  opacity?: number;
  draworder?: string;
};

type TiledAnimFrame = { tileid: number; duration: number };
type TiledTileDef = { id: number; animation?: TiledAnimFrame[]; image?: string };
type TiledTilesetDef = {
  firstgid: number;
  name: string;
  tilecount?: number;
  image?: string;
  tiles?: TiledTileDef[];
};

const GID_FLIP_H = 0x80000000;
const GID_FLIP_V = 0x40000000;
const GID_MASK = 0x0fffffff;

function stripGidFlags(gid: number): number {
  return gid & GID_MASK;
}

/** Tiled standard lookup on baked JSON — works for atlas + collection-of-images tilesets. */
function resolveGidTexture(
  scene: Phaser.Scene,
  tilesets: TiledTilesetDef[],
  gid: number,
): { textureKey: string; frame: number } | null {
  const cleanGid = stripGidFlags(gid);
  const sorted = [...tilesets].sort((a, b) => b.firstgid - a.firstgid);
  const tsMeta = sorted.find((ts) => cleanGid >= ts.firstgid);
  if (!tsMeta) return null;

  const localId = cleanGid - tsMeta.firstgid;

  // Collection-of-images: tile entry has its own image path.
  if (tsMeta.tiles?.length) {
    const tileDef = tsMeta.tiles.find((t) => t.id === localId);
    if (tileDef?.image) {
      if (!scene.textures.exists(tileDef.image)) return null;
      return { textureKey: tileDef.image, frame: 0 };
    }
  }

  // Atlas (including Campfire: tiles[] holds animation metadata only).
  if (tsMeta.image && scene.textures.exists(tsMeta.name)) {
    if (!scene.textures.getFrame(tsMeta.name, localId)) return null;
    return { textureKey: tsMeta.name, frame: localId };
  }

  return null;
}

/** Tiled tile objects anchor bottom-left at (x, y); match Phaser createFromObjects semantics. */
function placeTiledTileObject(
  sprite: Phaser.GameObjects.Sprite,
  rawObj: Phaser.Types.Tilemaps.TiledObject,
): void {
  sprite.setOrigin(0, 1);
  sprite.setPosition(rawObj.x * TILE_SCALE, rawObj.y * TILE_SCALE);
  sprite.setScale(TILE_SCALE);

  if (rawObj.flippedHorizontal !== undefined || rawObj.flippedVertical !== undefined) {
    sprite.setFlip(Boolean(rawObj.flippedHorizontal), Boolean(rawObj.flippedVertical));
  } else if (rawObj.gid) {
    sprite.setFlip((rawObj.gid & GID_FLIP_H) !== 0, (rawObj.gid & GID_FLIP_V) !== 0);
  }
}

function atlasTextureKey(scene: Phaser.Scene, ts: Phaser.Tilemaps.Tileset): string {
  if (scene.textures.exists(ts.name)) return ts.name;
  const imageKey =
    typeof ts.image === "string" ? ts.image : (ts.image as { key?: string } | undefined)?.key;
  if (imageKey && scene.textures.exists(imageKey)) return imageKey;
  return ts.name;
}

function linkTilesetTextures(
  map: Phaser.Tilemaps.Tilemap,
  scene: Phaser.Scene,
): Phaser.Tilemaps.Tileset[] {
  const linked: Phaser.Tilemaps.Tileset[] = [];
  const linkedNames = new Set<string>();

  for (const ts of map.tilesets) {
    if (linkedNames.has(ts.name)) continue;

    const textureKey = scene.textures.exists(ts.name)
      ? ts.name
      : ts.image
        ? atlasTextureKey(scene, ts)
        : null;

    if (!textureKey || !scene.textures.exists(textureKey)) {
      continue;
    }

    const added = map.addTilesetImage(ts.name, textureKey);
    if (added) {
      linked.push(added);
      linkedNames.add(ts.name);
    }
  }

  return linked;
}

function getTileAnimationFromCache(
  scene: Phaser.Scene,
  gid: number,
): { textureKey: string; animation: TiledAnimFrame[] } | null {
  const cacheEntry = scene.cache.tilemap.get(ASSET_KEYS.oneCityHome);
  const cleanGid = stripGidFlags(gid);
  const tilesets = [...((cacheEntry.data as { tilesets: TiledTilesetDef[] }).tilesets ?? [])].sort(
    (a, b) => b.firstgid - a.firstgid,
  );
  const tsMeta = tilesets.find((ts) => cleanGid >= ts.firstgid);
  if (!tsMeta?.tiles?.length) return null;
  const localId = cleanGid - tsMeta.firstgid;
  const tileDef = tsMeta.tiles.find((t) => t.id === localId);
  if (!tileDef?.animation?.length) return null;
  return { textureKey: tsMeta.name, animation: tileDef.animation };
}

/** Object-layer tile objects do not auto-animate; drive frames from Tiled tile animation metadata. */
function applyObjectTileAnimation(
  scene: Phaser.Scene,
  sprite: Phaser.GameObjects.Sprite,
  gid: number,
): void {
  const animMeta = getTileAnimationFromCache(scene, gid);
  if (!animMeta) return;

  const { textureKey, animation } = animMeta;
  let frameIndex = 0;

  const step = (): void => {
    if (!sprite.active) return;
    const frame = animation[frameIndex];
    sprite.setTexture(textureKey, frame.tileid);
    frameIndex = (frameIndex + 1) % animation.length;
    scene.time.delayedCall(frame.duration, step);
  };

  step();
}

/**
 * Beginning Fields Tiled JSON (40×40 @ 16px, scaled to 48px cells).
 * Plan A: sole ground art for chunk (0,0); no procedural floor inside bounds.
 */
export class HomeMapBackground {
  private layers: Phaser.GameObjects.GameObject[] = [];
  private map: Phaser.Tilemaps.Tilemap | null = null;
  private tilesets: Phaser.Tilemaps.Tileset[] = [];

  isReady(scene: Phaser.Scene): boolean {
    return (
      !isVisualFallbackActive(scene) &&
      scene.cache.tilemap.exists(ASSET_KEYS.oneCityHome) &&
      scene.textures.exists("Tileset_Ground")
    );
  }

  ensure(scene: Phaser.Scene): boolean {
    if (this.layers.length > 0) return true;
    if (!this.isReady(scene)) return false;

    const map = scene.add.tilemap(ASSET_KEYS.oneCityHome);
    this.tilesets = linkTilesetTextures(map, scene);
    if (this.tilesets.length === 0) return false;

    const cacheEntry = scene.cache.tilemap.get(ASSET_KEYS.oneCityHome);
    const layerMetas = (cacheEntry.data as { layers: TiledLayerMeta[] }).layers;
    const bakedTilesets = (cacheEntry.data as { tilesets: TiledTilesetDef[] }).tilesets ?? [];

    let depth = -1;
    for (const meta of layerMetas) {
      if (meta.visible === false) continue;
      if (SKIP_LAYER_NAMES.has(meta.name)) continue;

      if (meta.type === "tilelayer") {
        const layer = map.createLayer(meta.name, this.tilesets, 0, 0);
        if (!layer) continue;
        layer.setScale(TILE_SCALE);
        if (meta.opacity !== undefined && meta.opacity < 1) {
          layer.setAlpha(meta.opacity);
        }
        layer.setDepth(depth);
        depth += 0.01;
        this.layers.push(layer);
        continue;
      }

      if (meta.type === "objectgroup") {
        const rawLayer = map.getObjectLayer(meta.name);
        if (!rawLayer) continue;

        const isShadowLayer = meta.name === "Object Shadows";
        const sortedObjects =
          meta.draworder === "topdown"
            ? [...rawLayer.objects].sort((a, b) => {
                const yA = a.y ?? 0;
                const yB = b.y ?? 0;
                if (yA !== yB) return yA - yB;
                return (a.x ?? 0) - (b.x ?? 0);
              })
            : rawLayer.objects;

        for (const rawObj of sortedObjects) {
          if (!rawObj.gid) continue;

          const resolved = resolveGidTexture(scene, bakedTilesets, rawObj.gid);

          const sprite = resolved
            ? scene.add.sprite(0, 0, resolved.textureKey, resolved.frame)
            : scene.add.sprite(0, 0, "__MISSING");

          placeTiledTileObject(sprite, rawObj);
          if (meta.opacity !== undefined && meta.opacity < 1) {
            sprite.setAlpha(meta.opacity);
          }
          const bottomWorldX = (rawObj.x ?? 0) * TILE_SCALE;
          const bottomWorldY = (rawObj.y ?? 0) * TILE_SCALE;
          sprite.setDepth(
            tiledObjectYSortDepth(
              bottomWorldX,
              bottomWorldY,
              isShadowLayer ? YSORT_LAYER.SHADOW : YSORT_LAYER.OBJECT,
            ),
          );

          if (resolved) {
            applyObjectTileAnimation(scene, sprite, rawObj.gid);
          }

          this.layers.push(sprite);
        }
      }
    }

    if (this.layers.length === 0) return false;
    this.map = map;

    return true;
  }

  /** Returns whether Beginning Fields Tiled art is active. */
  refresh(scene: Phaser.Scene): boolean {
    if (isVisualFallbackActive(scene)) {
      this.setVisible(false);
      return false;
    }
    if (!this.ensure(scene)) {
      this.setVisible(false);
      return false;
    }
    this.setVisible(true);
    return true;
  }

  private setVisible(visible: boolean): void {
    for (const layer of this.layers) {
      if ("setVisible" in layer && typeof layer.setVisible === "function") {
        layer.setVisible(visible);
      }
    }
  }

  destroy(): void {
    for (const layer of this.layers) {
      layer.destroy();
    }
    this.map?.destroy();
    this.layers = [];
    this.map = null;
    this.tilesets = [];
  }
}
