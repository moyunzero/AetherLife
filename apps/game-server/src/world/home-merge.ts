import type { ChunkBase, ChunkBaseTile, RoomState } from "@aetherlife/shared";

/**
 * Merge noise base with legacy default room for chunk (0,0).
 * Home chunk: all tiles home biome + walkable terrain; object/NPC blocking stays in move grid.
 */
export function mergeHomeChunkBase(base: ChunkBase, _defaultRoom: RoomState): ChunkBase {
  if (base.cx !== 0 || base.cy !== 0) return base;
  const tiles: ChunkBaseTile[] = base.tiles.map((t) => ({
    ...t,
    biome: "home",
    walkable: true,
  }));
  return { cx: 0, cy: 0, tiles };
}
