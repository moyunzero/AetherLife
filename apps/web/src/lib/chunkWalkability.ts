import {
  CHUNK_SIZE,
  chunkOf,
  buildGlobalMoveGrid,
  canStepGlobal,
  findGlobalGridPath,
  type BiomeId,
  type ChunkView,
  type RoomState,
} from "@aetherlife/shared";
import { isTerrainWalkable } from "../game/floorBlocked.js";

export { isTerrainWalkable as tileWalkable };

export function biomeAt(
  chunks: readonly ChunkView[],
  gx: number,
  gy: number,
): BiomeId | "void" {
  const { cx, cy } = chunkOf(gx, gy);
  const chunk = chunks.find((c) => c.cx === cx && c.cy === cy);
  if (!chunk) return "void";
  const lx = ((gx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
  const ly = ((gy % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
  return chunk.tiles.find((t) => t.lx === lx && t.ly === ly)?.biome ?? "void";
}

export function clientCanStep(
  map: RoomState,
  gx: number,
  gy: number,
  otherPlayers: readonly { x: number; y: number }[],
  chunks: readonly ChunkView[],
): boolean {
  const grid = buildGlobalMoveGrid({
    homeMap: map,
    otherPlayerCells: otherPlayers,
    isTerrainWalkable: (x, y) => isTerrainWalkable(chunks, x, y),
  });
  return canStepGlobal(gx, gy, grid);
}

export type ClientFindPathOptions = {
  /** Omit this NPC from blocked cells (pathfinding for that NPC's move). */
  excludeNpcId?: string;
};

export function clientFindPath(
  map: RoomState,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  otherPlayers: readonly { x: number; y: number }[],
  chunks: readonly ChunkView[],
  options?: ClientFindPathOptions,
) {
  const grid = buildGlobalMoveGrid({
    homeMap: map,
    otherPlayerCells: otherPlayers,
    isTerrainWalkable: (x, y) => isTerrainWalkable(chunks, x, y),
    excludeNpcId: options?.excludeNpcId,
  });
  return findGlobalGridPath(fromX, fromY, toX, toY, grid);
}
