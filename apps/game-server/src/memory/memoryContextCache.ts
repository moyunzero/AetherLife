import { stableStringHash } from "@aetherlife/shared";
import type { MemoryContext } from "./service.js";

const TTL_MS = 5000;
const MAX_ENTRIES = 2000;

type CacheEntry = {
  expiresAt: number;
  context: MemoryContext;
};

const cache = new Map<string, CacheEntry>();

export function memoryContextCacheKey(
  roomId: string,
  playerId: string,
  npcId: string,
  playerMessage: string,
  skipEmbed: boolean,
): string {
  const msgHash = stableStringHash(playerMessage.trim());
  return `${roomId}:${playerId}:${npcId}:${skipEmbed ? 1 : 0}:${msgHash}`;
}

function pruneExpired(): void {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (now > entry.expiresAt) {
      cache.delete(key);
    }
  }
}

function evictOldestWhileOverMax(): void {
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export function getCachedMemoryContext(key: string): MemoryContext | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.context;
}

export function setCachedMemoryContext(key: string, context: MemoryContext): void {
  pruneExpired();
  cache.set(key, { expiresAt: Date.now() + TTL_MS, context });
  evictOldestWhileOverMax();
}

/** Drop cached memory-context for one player after memory writes (mirror workerStateCache). */
export function invalidateMemoryContextForPlayer(
  roomId: string,
  playerId: string,
  npcId?: string,
): void {
  const prefix = npcId
    ? `${roomId}:${playerId}:${npcId}:`
    : `${roomId}:${playerId}:`;
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
    }
  }
}

/** Test helper */
export function clearMemoryContextCache(): void {
  cache.clear();
}
