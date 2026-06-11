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

/**
 * Determines whether the client can move onto a specified global cell, taking into account other players and terrain walkability.
 *
 * @param map - The room state used as the client's home map context.
 * @param gx - Target global X coordinate.
 * @param gy - Target global Y coordinate.
 * @param otherPlayers - Occupied global cells of other players (each entry has `x` and `y`) treated as blocked.
 * @param chunks - Chunk views used to evaluate terrain walkability at global coordinates.
 * @returns `true` if the client can step onto the target cell, `false` otherwise.
 */
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

/**
 * Finds a path between two global coordinates on a client-side global move grid.
 *
 * @param otherPlayers - Cells occupied by other players to mark as blocked on the grid
 * @param chunks - Chunk views used to determine terrain walkability for global coordinates
 * @param options - Pathfinding options
 * @param options.excludeNpcId - Omit this NPC from blocked cells when building the move grid
 * @returns The path produced by the global pathfinding routine for the constructed grid
 */
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
