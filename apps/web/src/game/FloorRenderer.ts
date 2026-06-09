import { CHUNK_SIZE, type ChunkView, type RoomState } from "@aetherlife/shared";
import type * as Phaser from "phaser";
import { ASSET_KEYS } from "./assetManifest.js";
import { isGlobalFloorBlocked } from "./floorBlocked.js";
import { CELL_PX } from "./gridLayout.js";
import { TILE_PX } from "./assetManifest.js";

/** Match decor/sprites: 16px atlas tiles fill 48px grid cells (3× scale). */
const FLOOR_TILE_SCALE = CELL_PX / TILE_PX;
import {
  isWetlandShoreCell,
  shoreIndexFor,
  tileIndexFor,
  voidTileIndexFor,
} from "./tileBiome.js";
import { tintForBiome } from "./pastoralTint.js";
import { isHomeMapCell } from "./HomeMapBackground.js";
import { theme } from "./theme.js";
import type { BiomeId } from "@aetherlife/shared";

type CellMeta = { biome: BiomeId; walkable: boolean };

const MAP_TILES = 256;

function cellKey(gx: number, gy: number): string {
  return `${gx},${gy}`;
}

export class FloorRenderer {
  private map: Phaser.Tilemaps.Tilemap | null = null;
  private layer: Phaser.Tilemaps.TilemapLayer | null = null;
  private debugGfx: Phaser.GameObjects.Graphics | null = null;

  ensure(scene: Phaser.Scene): boolean {
    if (this.layer) return true;
    if (!scene.textures.exists(ASSET_KEYS.tilesBiomes)) return false;

    const map = scene.make.tilemap({
      tileWidth: TILE_PX,
      tileHeight: TILE_PX,
      width: MAP_TILES,
      height: MAP_TILES,
    });
    const tileset = map.addTilesetImage(
      "biomes",
      ASSET_KEYS.tilesBiomes,
      TILE_PX,
      TILE_PX,
    );
    if (!tileset) return false;

    const layer = map.createBlankLayer("floor", tileset, 0, 0, MAP_TILES, MAP_TILES);
    if (!layer) return false;

    layer.setDepth(0);
    layer.setScale(FLOOR_TILE_SCALE);
    this.map = map;
    this.layer = layer;
    return true;
  }

  refresh(
    scene: Phaser.Scene,
    chunks: ChunkView[],
    moveMap: RoomState | undefined,
    terrainDebug: boolean,
    homeMapActive = false,
  ): void {
    if (!this.ensure(scene)) return;

    const layer = this.layer!;
    const cellMap = new Map<string, CellMeta>();

    if (chunks.length === 0) {
      for (let y = 0; y < 8; y += 1) {
        for (let x = 0; x < 8; x += 1) {
          const blocked = isGlobalFloorBlocked(moveMap, chunks, x, y);
          cellMap.set(cellKey(x, y), {
            biome: "home",
            walkable: !blocked,
          });
        }
      }
    } else {
      for (const chunk of chunks) {
        for (const tile of chunk.tiles) {
          const gx = chunk.cx * CHUNK_SIZE + tile.lx;
          const gy = chunk.cy * CHUNK_SIZE + tile.ly;
          cellMap.set(cellKey(gx, gy), {
            biome: tile.biome,
            walkable: tile.walkable,
          });
        }
      }
    }

    const bounds = this.paintBounds(chunks);
    for (let gy = bounds.minGy; gy <= bounds.maxGy; gy += 1) {
      for (let gx = bounds.minGx; gx <= bounds.maxGx; gx += 1) {
        if (homeMapActive && isHomeMapCell(gx, gy)) {
          layer.removeTileAt(gx, gy);
          continue;
        }
        layer.putTileAt(voidTileIndexFor(gx, gy), gx, gy);
      }
    }

    for (const [key, meta] of cellMap) {
      const [gxStr, gyStr] = key.split(",");
      const gx = Number(gxStr);
      const gy = Number(gyStr);
      if (homeMapActive && isHomeMapCell(gx, gy)) continue;
      const index = this.resolveTileIndex(gx, gy, meta, cellMap);
      layer.putTileAt(index, gx, gy);
    }

    this.applyPastoralFloorTints(layer, cellMap, homeMapActive);

    if (terrainDebug) {
      if (!this.debugGfx) {
        this.debugGfx = scene.add.graphics().setDepth(0.5);
      }
      this.debugGfx.clear();
      for (const chunk of chunks) {
        const left = chunk.cx * CHUNK_SIZE * CELL_PX;
        const top = chunk.cy * CHUNK_SIZE * CELL_PX;
        const size = CHUNK_SIZE * CELL_PX;
        this.debugGfx.lineStyle(1, theme.accentDim, 0.55);
        this.debugGfx.strokeRect(left, top, size, size);
      }
    } else if (this.debugGfx) {
      this.debugGfx.destroy();
      this.debugGfx = null;
    }
  }

  /** Loaded chunks + one chunk margin; default home 8×8 when empty. */
  private paintBounds(chunks: ChunkView[]): {
    minGx: number;
    maxGx: number;
    minGy: number;
    maxGy: number;
  } {
    const margin = 1;
    if (chunks.length === 0) {
      return { minGx: 0, maxGx: 7, minGy: 0, maxGy: 7 };
    }
    let minCx = chunks[0]!.cx;
    let maxCx = chunks[0]!.cx;
    let minCy = chunks[0]!.cy;
    let maxCy = chunks[0]!.cy;
    for (const chunk of chunks) {
      minCx = Math.min(minCx, chunk.cx);
      maxCx = Math.max(maxCx, chunk.cx);
      minCy = Math.min(minCy, chunk.cy);
      maxCy = Math.max(maxCy, chunk.cy);
    }
    return {
      minGx: (minCx - margin) * CHUNK_SIZE,
      maxGx: (maxCx + margin + 1) * CHUNK_SIZE - 1,
      minGy: (minCy - margin) * CHUNK_SIZE,
      maxGy: (maxCy + margin + 1) * CHUNK_SIZE - 1,
    };
  }

  /** Runtime pastoral warmth per biome (13.2 D-tint); void tiles keep atlas default. */
  private applyPastoralFloorTints(
    layer: Phaser.Tilemaps.TilemapLayer,
    cellMap: Map<string, CellMeta>,
    homeMapActive = false,
  ): void {
    for (const [key, meta] of cellMap) {
      const [gxStr, gyStr] = key.split(",");
      const gx = Number(gxStr);
      const gy = Number(gyStr);
      if (homeMapActive && isHomeMapCell(gx, gy)) continue;
      const tile = layer.getTileAt(gx, gy);
      if (!tile) continue;
      tile.tint = tintForBiome(meta.biome);
    }
  }

  private resolveTileIndex(
    gx: number,
    gy: number,
    meta: CellMeta,
    cellMap: Map<string, CellMeta>,
  ): number {
    if (meta.walkable && meta.biome === "wetland") {
      for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
        const n = cellMap.get(cellKey(gx + dx, gy + dy));
        if (isWetlandShoreCell(meta.biome, meta.walkable, n?.biome ?? null)) {
          return shoreIndexFor(meta.biome);
        }
      }
    }
    return tileIndexFor(meta.biome, meta.walkable, gx, gy);
  }

  destroy(): void {
    this.layer?.destroy();
    this.map?.destroy();
    this.debugGfx?.destroy();
    this.layer = null;
    this.map = null;
    this.debugGfx = null;
  }
}
