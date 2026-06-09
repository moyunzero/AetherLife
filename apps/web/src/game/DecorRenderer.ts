import { CHUNK_SIZE, type BiomeId, type ChunkView } from "@aetherlife/shared";
import type * as Phaser from "phaser";
import { ASSET_KEYS, TILE_PX } from "./assetManifest.js";
import { CELL_PX, ySortDepth, YSORT_LAYER } from "./entityLayout.js";
import { gridToWorld } from "./gridLayout.js";
import { isHomeMapCell } from "./HomeMapBackground.js";
import { decorForBlockedCell, homeDecorPlacements, type DecorPlacement } from "./homeLayout.js";
import { decorTintForPlacement } from "./pastoralTint.js";
import { isVisualFallbackActive } from "./visualFallback.js";

type DecorSprite = Phaser.GameObjects.Image;

type DecorSpawn = {
  placement: DecorPlacement;
  chunkCx: number;
  chunkCy: number;
  biome: BiomeId;
};


function parseWorldSeed(): number {
  if (typeof import.meta !== "undefined" && import.meta.env?.VITE_WORLD_SEED) {
    const n = Number.parseInt(String(import.meta.env.VITE_WORLD_SEED), 10);
    if (Number.isFinite(n)) return n;
  }
  return 42;
}

export class DecorRenderer {
  private sprites: DecorSprite[] = [];
  private lastFingerprint = "";

  refresh(scene: Phaser.Scene, chunks: ChunkView[], homeMapActive = false): void {
    if (isVisualFallbackActive(scene)) {
      this.clear();
      return;
    }
    if (!scene.textures.exists(ASSET_KEYS.tilesDecor)) {
      this.clear();
      return;
    }

    const worldSeed = parseWorldSeed();
    const placed = new Set<string>();
    const spawns: DecorSpawn[] = [];
    const uatHomestead = scene.registry.get("uatHomesteadFrame") === true;

    const fp = `${uatHomestead ? "uat-homestead" : "play"}|${homeMapActive ? "map" : "proc"}|${chunks
      .map((c) => `${c.cx},${c.cy}`)
      .sort()
      .join("|")}`;
    if (fp === this.lastFingerprint) return;
    this.lastFingerprint = fp;
    this.clear();

    for (const chunk of chunks) {
      for (const p of homeDecorPlacements(worldSeed, chunk.cx, chunk.cy)) {
        if (homeMapActive && isHomeMapCell(p.gx, p.gy)) continue;
        spawns.push({ placement: p, chunkCx: chunk.cx, chunkCy: chunk.cy, biome: "home" });
      }
      if (uatHomestead) continue;
      for (const tile of chunk.tiles) {
        if (tile.walkable) continue;
        const gx = chunk.cx * CHUNK_SIZE + tile.lx;
        const gy = chunk.cy * CHUNK_SIZE + tile.ly;
        if (homeMapActive && isHomeMapCell(gx, gy)) continue;
        const key = `${gx},${gy}`;
        if (placed.has(key)) continue;
        const decor = decorForBlockedCell(gx, gy, tile.biome, worldSeed);
        if (decor) {
          spawns.push({
            placement: decor,
            chunkCx: chunk.cx,
            chunkCy: chunk.cy,
            biome: tile.biome as BiomeId,
          });
          placed.add(key);
          if (decor.size === 2) {
            placed.add(`${gx + 1},${gy}`);
            placed.add(`${gx},${gy - 1}`);
            placed.add(`${gx + 1},${gy - 1}`);
          }
        }
      }
    }

    for (const spawn of spawns) {
      this.spawnDecor(scene, spawn);
    }
  }

  private spawnDecor(scene: Phaser.Scene, spawn: DecorSpawn): void {
    const p = spawn.placement;
    const tint = decorTintForPlacement(spawn.biome, spawn.chunkCx, spawn.chunkCy);
    const { wx, wy } = gridToWorld(p.gx, p.gy);
    const scale = CELL_PX / TILE_PX;
    if (p.size === 2) {
      for (let dy = 0; dy >= -1; dy -= 1) {
        for (let dx = 0; dx <= 1; dx += 1) {
          const frame = p.frame + (dy === 0 ? 0 : 2) + dx;
          const img = scene.add.image(wx + dx * CELL_PX, wy + dy * CELL_PX, ASSET_KEYS.tilesDecor, frame);
          img.setOrigin(0.5, 1);
          img.setScale(scale);
          img.setTint(tint);
          img.setDepth(
            ySortDepth(wx + dx * CELL_PX, wy + dy * CELL_PX, YSORT_LAYER.DECOR),
          );
          this.sprites.push(img);
        }
      }
      return;
    }

    const img = scene.add.image(wx, wy, ASSET_KEYS.tilesDecor, p.frame);
    img.setOrigin(0.5, 1);
    img.setScale(scale);
    img.setTint(tint);
    img.setDepth(ySortDepth(wx, wy, YSORT_LAYER.DECOR));
    this.sprites.push(img);
  }

  clear(): void {
    for (const s of this.sprites) s.destroy();
    this.sprites = [];
  }

  destroy(): void {
    this.clear();
    this.lastFingerprint = "";
  }
}
