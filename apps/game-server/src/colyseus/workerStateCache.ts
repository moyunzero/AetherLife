import type { RoomState } from "@aetherlife/shared";

const TTL_MS_SKIP_LORE = 8000;
const TTL_MS_WITH_LORE = 2500;

type WorkerStatePayload = {
  state: RoomState;
  nearbyLore: Array<{ cx: number; cy: number; nameZh: string; flavorOneLine: string }>;
};

type CacheEntry = {
  expiresAt: number;
  payload: WorkerStatePayload;
};

const cache = new Map<string, CacheEntry>();

export function workerStateCacheKey(
  roomId: string,
  playerId: string,
  skipNearbyLore: boolean,
): string {
  return `${roomId}:${playerId}:${skipNearbyLore ? 1 : 0}`;
}

export function getCachedWorkerState(key: string): WorkerStatePayload | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.payload;
}

export function setCachedWorkerState(
  key: string,
  payload: WorkerStatePayload,
  skipNearbyLore: boolean,
): void {
  const ttl = skipNearbyLore ? TTL_MS_SKIP_LORE : TTL_MS_WITH_LORE;
  cache.set(key, { expiresAt: Date.now() + ttl, payload });
}

/** Drop cached worker-state for one player after Colyseus move (WR-02). */
export function invalidateWorkerStateForPlayer(roomId: string, playerId: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(`${roomId}:${playerId}:`)) {
      cache.delete(key);
    }
  }
}

/** Test helper */
export function clearWorkerStateCache(): void {
  cache.clear();
}
