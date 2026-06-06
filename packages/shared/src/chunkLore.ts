import type { BiomeId, ChunkTileView } from "./chunk.js";

/** Mode biome across an 8×8 chunk tile window. */
export function dominantBiomeFromTiles(tiles: ChunkTileView[]): BiomeId {
  if (tiles.length === 0) return "meadow";
  const counts = new Map<BiomeId, number>();
  for (const t of tiles) {
    counts.set(t.biome, (counts.get(t.biome) ?? 0) + 1);
  }
  let best: BiomeId = tiles[0]!.biome;
  let bestCount = 0;
  for (const [biome, count] of counts) {
    if (count > bestCount) {
      best = biome;
      bestCount = count;
    }
  }
  return best;
}

export function walkableRatioFromTiles(tiles: ChunkTileView[]): number {
  if (tiles.length === 0) return 0;
  const walkable = tiles.filter((t) => t.walkable).length;
  return walkable / tiles.length;
}

export function loreJobId(worldId: string, cx: number, cy: number): string {
  return `lore-${worldId}-${cx}-${cy}`;
}

export function lorePendingRedisKey(worldId: string, cx: number, cy: number): string {
  return `lore:pending:${worldId}:${cx}:${cy}`;
}

export function lorePlayerDiscoveriesRedisKey(playerId: string): string {
  return `lore:player-discoveries:${playerId}`;
}
