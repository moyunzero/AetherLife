import {
  CHUNK_SIZE,
  biomeAtGlobal,
  chunkOf,
  type ChunkView,
  type RoomState,
} from "@aetherlife/shared";
import { clientWorldSeed } from "../lib/worldSeed.js";
import { regionWalkabilityAt } from "./regionCollision.js";

/**
 * Create a string key for a grid coordinate.
 *
 * @param x - The x coordinate of the cell
 * @param y - The y coordinate of the cell
 * @returns The key formatted as "x,y"
 */
function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

/** Static floor blockers (NPC cells + closed doors) — not other players. */
export function isStaticFloorBlocked(
  map: RoomState | undefined,
  x: number,
  y: number,
): boolean {
  if (!map) return false;
  const key = cellKey(x, y);
  for (const npc of map.npcs) {
    if (cellKey(npc.x, npc.y) === key) return true;
  }
  for (const obj of map.objects) {
    if (obj.kind === "door" && obj.state === "closed" && cellKey(obj.x, obj.y) === key) {
      return true;
    }
  }
  return false;
}

/**
 * Determine whether the terrain at the given global coordinates is walkable.
 *
 * This consults any region-level walkability override, then checks the matching loaded chunk tile if available, and falls back to the global biome's walkability when the chunk is not present.
 *
 * @param chunks - Loaded chunk views to consult for tile-level walkability
 * @param gx - Global X coordinate
 * @param gy - Global Y coordinate
 * @param worldSeed - World seed used to resolve biome walkability when no chunk is available
 * @returns `true` if the terrain at `(gx, gy)` is walkable, `false` otherwise.
 */
export function isTerrainWalkable(
  chunks: readonly ChunkView[],
  gx: number,
  gy: number,
  worldSeed: number = clientWorldSeed(),
): boolean {
  const regionWalk = regionWalkabilityAt(gx, gy);
  if (regionWalk !== undefined) return regionWalk;

  const { cx, cy } = chunkOf(gx, gy);
  const chunk = chunks.find((c) => c.cx === cx && c.cy === cy);
  if (chunk) {
    const lx = ((gx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const ly = ((gy % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const tile = chunk.tiles.find((t) => t.lx === lx && t.ly === ly);
    return tile?.walkable ?? false;
  }
  return biomeAtGlobal(gx, gy, worldSeed).walkable;
}

/** Global cell blocked by terrain void or home-chunk static actors. */
export function isGlobalFloorBlocked(
  map: RoomState | undefined,
  chunks: readonly ChunkView[],
  gx: number,
  gy: number,
): boolean {
  if (!isTerrainWalkable(chunks, gx, gy)) return true;
  const { cx, cy } = chunkOf(gx, gy);
  if (cx === 0 && cy === 0) {
    return isStaticFloorBlocked(map, gx, gy);
  }
  return false;
}
