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

export function setCachedWorkerState(key: string, payload: WorkerStatePayload): void {
  cache.set(key, { expiresAt: Date.now() + TTL_MS, payload });
}

/** Test helper */
export function clearWorkerStateCache(): void {
  cache.clear();
}
