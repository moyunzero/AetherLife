import { HOME_MAP_TILE_H, HOME_MAP_TILE_W, isHomeMapRegionCell } from "@aetherlife/shared";
import type * as Phaser from "phaser";
import { ASSET_KEYS, TILE_PX } from "./assetManifest.js";
import { CELL_PX } from "./gridLayout.js";
import { isVisualFallbackActive } from "./visualFallback.js";

export { HOME_MAP_TILE_H, HOME_MAP_TILE_W, isHomeMapRegionCell as isHomeMapCell };

const TILE_SCALE = CELL_PX / TILE_PX;

const HOME_MAP_LAYERS = ["背景", "Layer_1"] as const;

/**
 * SpriteFusion Tiled JSON background for chunk (0,0) homestead.
 * Procedural floor/decor skip cells inside this bounds when active.
 */
export class HomeMapBackground {
  private layers: Phaser.Tilemaps.TilemapLayer[] = [];
  private map: Phaser.Tilemaps.Tilemap | null = null;

  isReady(scene: Phaser.Scene): boolean {
    return (
      !isVisualFallbackActive(scene) &&
      scene.cache.tilemap.exists(ASSET_KEYS.mapTestHome) &&
      scene.textures.exists(ASSET_KEYS.mapTestTiles)
    );
  }

  ensure(scene: Phaser.Scene): boolean {
    if (this.layers.length > 0) return true;
    if (!this.isReady(scene)) return false;

    const map = scene.add.tilemap(ASSET_KEYS.mapTestHome);
    const tileset = map.addTilesetImage(
      "spritefusion",
      ASSET_KEYS.mapTestTiles,
      TILE_PX,
      TILE_PX,
    );
    if (!tileset) return false;

    HOME_MAP_LAYERS.forEach((name, index) => {
      const layer = map.createLayer(name, tileset, 0, 0);
      if (!layer) return;
      layer.setScale(TILE_SCALE);
      layer.setDepth(-1 + index * 0.01);
      this.layers.push(layer);
    });

    if (this.layers.length === 0) return false;
    this.map = map;
    return true;
  }

  /** Returns whether homestead Tiled art is covering the initial area. */
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
      layer.setVisible(visible);
    }
  }

  destroy(): void {
    for (const layer of this.layers) {
      layer.destroy();
    }
    this.map?.destroy();
    this.layers = [];
    this.map = null;
  }
}
