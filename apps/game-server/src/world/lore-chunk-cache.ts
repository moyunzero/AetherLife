import type { ChunkLoreRow } from "./lore-repository.js";
import { getChunkLore } from "./lore-repository.js";
import { runWithLoreConcurrencyLimit } from "../util/concurrencyGate.js";

const TTL_MS = 10 * 60 * 1000;

type CacheEntry = {
  expiresAt: number;
  row: ChunkLoreRow | null;
};

const cache = new Map<string, CacheEntry>();

function cacheKey(worldId: string, cx: number, cy: number): string {
  return `${worldId}:${cx}:${cy}`;
}

/** Cached chunk lore for speak hot path (10min TTL). */
export async function getChunkLoreCached(
  worldId: string,
  cx: number,
  cy: number,
): Promise<ChunkLoreRow | null> {
  const key = cacheKey(worldId, cx, cy);
  const hit = cache.get(key);
  if (hit && Date.now() <= hit.expiresAt) {
    return hit.row;
  }
  const row = await runWithLoreConcurrencyLimit(() => getChunkLore(worldId, cx, cy));
  cache.set(key, { expiresAt: Date.now() + TTL_MS, row });
  return row;
}

/** Test helper */
export function clearChunkLoreCache(): void {
  cache.clear();
}
