import type Phaser from "phaser";
import type { BiomeId, ChunkView, RoomState } from "@aetherlife/shared";
import { CHUNK_SIZE } from "@aetherlife/shared";
import { CELL_PX } from "./gridLayout.js";
import { isGlobalFloorBlocked } from "./floorBlocked.js";
import { isVisualFallbackActive } from "./visualFallback.js";
import { theme } from "./theme.js";
import type { DecorRenderer } from "./DecorRenderer.js";
import type { FloorRenderer } from "./FloorRenderer.js";
import type { HomeMapBackground } from "./HomeMapBackground.js";

export type RoomSceneFloorCtx = {
  scene: Phaser.Scene;
  floorGfx: Phaser.GameObjects.Graphics;
  floorRenderer: FloorRenderer;
  decorRenderer: DecorRenderer;
  homeMapBackground: HomeMapBackground;
  getLoadedChunks: () => ChunkView[];
  getMoveMap: () => RoomState;
  terrainDebug: () => boolean;
};

export function biomeTileColor(biome: BiomeId | "void", walkable: boolean): number {
  if (biome === "void") {
    return walkable ? theme.biomeVoid.walkable : theme.biomeVoid.blocked;
  }
  const pair = theme.biomeColors[biome];
  return walkable ? pair.walkable : pair.blocked;
}

export function drawFloor(ctx: RoomSceneFloorCtx): void {
  if (isVisualFallbackActive(ctx.scene)) {
    drawFloorGraphics(ctx);
    return;
  }
  ctx.floorGfx.clear();
  const homeMapActive = ctx.homeMapBackground.refresh(ctx.scene);
  if (homeMapActive) {
    return;
  }
  ctx.floorRenderer.refresh(
    ctx.scene,
    ctx.getLoadedChunks(),
    ctx.getMoveMap(),
    ctx.terrainDebug(),
    false,
  );
  ctx.decorRenderer.refresh(ctx.scene, ctx.getLoadedChunks(), false);
}

/** Graphics fallback — visualFallback query or loader failure (D-23). */
export function drawFloorGraphics(ctx: RoomSceneFloorCtx): void {
  const chunks = ctx.getLoadedChunks();
  ctx.floorGfx.clear();
  if (chunks.length === 0) {
    const map = ctx.getMoveMap();
    for (let y = 0; y < map.height; y += 1) {
      for (let x = 0; x < map.width; x += 1) {
        const blocked = isGlobalFloorBlocked(map, chunks, x, y);
        ctx.floorGfx.fillStyle(blocked ? theme.floorBlocked : theme.floorWalkable, 1);
        ctx.floorGfx.fillRect(x * CELL_PX, y * CELL_PX, CELL_PX, CELL_PX);
        ctx.floorGfx.lineStyle(1, theme.gridLine, 1);
        ctx.floorGfx.strokeRect(x * CELL_PX, y * CELL_PX, CELL_PX, CELL_PX);
      }
    }
    return;
  }

  for (const chunk of chunks) {
    for (const tile of chunk.tiles) {
      const gx = chunk.cx * CHUNK_SIZE + tile.lx;
      const gy = chunk.cy * CHUNK_SIZE + tile.ly;
      const fill = biomeTileColor(tile.biome, tile.walkable);
      ctx.floorGfx.fillStyle(fill, 1);
      ctx.floorGfx.fillRect(gx * CELL_PX, gy * CELL_PX, CELL_PX, CELL_PX);
      ctx.floorGfx.lineStyle(1, theme.gridLine, 1);
      ctx.floorGfx.strokeRect(gx * CELL_PX, gy * CELL_PX, CELL_PX, CELL_PX);
    }
    if (ctx.terrainDebug()) {
      const left = chunk.cx * CHUNK_SIZE * CELL_PX;
      const top = chunk.cy * CHUNK_SIZE * CELL_PX;
      const size = CHUNK_SIZE * CELL_PX;
      ctx.floorGfx.lineStyle(1, theme.accentDim, 0.55);
      ctx.floorGfx.strokeRect(left, top, size, size);
    }
  }
}
