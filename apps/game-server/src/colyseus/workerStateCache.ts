import type { RoomState } from "@aetherlife/shared";

const TTL_MS = 2500;

type WorkerStatePayload = {
  state: RoomState;
  nearbyLore: Array<{ cx: number; cy: number; nameZh: string; flavorOneLine: string }>;
};

type CacheEntry = {
  expiresAt: number;
  payload: WorkerStatePayload;
};

const cache = new Map<string, CacheEntry>();

/**
 * Create a deterministic cache key for worker state from room, player, and a nearby-lore flag.
 *
 * @param roomId - The room identifier
 * @param playerId - The player identifier
 * @param skipNearbyLore - If `true`, nearby lore is omitted; encoded as `1` when `true`, `0` when `false`
 * @returns The cache key in the form `roomId:playerId:1` or `roomId:playerId:0`
 */
export function workerStateCacheKey(
  roomId: string,
  playerId: string,
  skipNearbyLore: boolean,
): string {
  return `${roomId}:${playerId}:${skipNearbyLore ? 1 : 0}`;
}

/**
 * Retrieves a cached worker state for the given cache key, removing the entry if it has expired.
 *
 * @param key - Cache key formatted as `roomId:playerId:skipNearbyLore`
 * @returns The cached WorkerStatePayload if present and not expired, `null` otherwise.
 */
export function getCachedWorkerState(key: string): WorkerStatePayload | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.payload;
}

/**
 * Store a worker state payload in the in-memory cache and set its expiration.
 *
 * Sets or overwrites the cache entry for `key` with `payload` and marks it to expire after the module's TTL.
 *
 * @param key - Cache key (format: `${roomId}:${playerId}:${skipNearbyLore ? 1 : 0}`)
 * @param payload - The worker state payload to cache
 */
export function setCachedWorkerState(key: string, payload: WorkerStatePayload): void {
  cache.set(key, { expiresAt: Date.now() + TTL_MS, payload });
}

/**
 * Clears all entries from the in-memory worker state cache.
 *
 * Primarily intended for test setup/teardown to ensure no stale cache state remains.
 */
export function clearWorkerStateCache(): void {
  cache.clear();
}
