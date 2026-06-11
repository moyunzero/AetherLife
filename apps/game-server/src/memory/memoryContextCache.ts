import { stableStringHash } from "@aetherlife/shared";
import type { MemoryContext } from "./service.js";

const TTL_MS = 5000;

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
  cache.set(key, { expiresAt: Date.now() + TTL_MS, context });
}

/** Test helper */
export function clearMemoryContextCache(): void {
  cache.clear();
}
