import {
  CHUNK_SIZE,
  chunkOf,
  dominantBiomeFromTiles,
  HOME_CHUNK_LORE,
  lorePendingRedisKey,
  lorePlayerDiscoveriesRedisKey,
  toChunkLorePublic,
  walkableRatioFromTiles,
  type BiomeId,
  type ChunkLore,
  type ColyseusLoreSyncPayload,
} from "@aetherlife/shared";
import { Redis } from "ioredis";
import { incrementLoreEnqueueCounter } from "../metrics/lore-metrics.js";
import { addChunkLoreJob } from "../queue/chunk-lore.js";
import { broadcastLoreSync } from "./lore-broadcast.js";
import { getChunkLoader } from "./chunk-loader.js";
import { getChunkLore } from "./lore-repository.js";
import { worldSeedFromEnv } from "./seed.js";

export type LoreModelTier = "T0" | "T1";

/** Skip LLM for home anchor chunk only (D-02). */
export function shouldSkipLoreGeneration(cx: number, cy: number): boolean {
  return cx === 0 && cy === 0;
}

/** True when global cell crosses chunk boundary. */
export function chunkCrossed(
  prevGx: number,
  prevGy: number,
  nextGx: number,
  nextGy: number,
): boolean {
  const prev = chunkOf(prevGx, prevGy);
  const next = chunkOf(nextGx, nextGy);
  return prev.cx !== next.cx || prev.cy !== next.cy;
}

/** T1 on player's first successful enqueue; T0 thereafter (D-14). */
export function resolveModelTier(playerDiscoveryCount: number): LoreModelTier {
  return playerDiscoveryCount === 0 ? "T1" : "T0";
}

export function shouldEnqueueWhenNoRow(row: unknown | null | undefined): boolean {
  return row == null;
}

export function buildLoreSyncEntry(input: {
  cx: number;
  cy: number;
  status: ColyseusLoreSyncPayload["entries"][number]["status"];
  lore?: ChunkLore;
  isFirstDiscover?: boolean;
}): ColyseusLoreSyncPayload["entries"][number] {
  const entry: ColyseusLoreSyncPayload["entries"][number] = {
    cx: input.cx,
    cy: input.cy,
    status: input.status,
  };
  if (input.lore) entry.lore = toChunkLorePublic(input.lore);
  if (input.isFirstDiscover) entry.isFirstDiscover = true;
  return entry;
}

/** Document: GameRoom must capture prevGx/prevGy before applyPlayerMove mutates position. */
export const CHUNK_CROSS_CHUNK_SIZE = CHUNK_SIZE;

const memoryPending = new Set<string>();
const memoryDiscoveries = new Map<string, number>();

function createRedis(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: null });
}

async function tryAcquirePending(worldId: string, cx: number, cy: number): Promise<boolean> {
  const key = lorePendingRedisKey(worldId, cx, cy);
  const url = process.env.REDIS_URL;
  if (!url) {
    if (memoryPending.has(key)) return false;
    memoryPending.add(key);
    setTimeout(() => memoryPending.delete(key), 120_000);
    return true;
  }
  const client = createRedis(url);
  try {
    const res = await client.set(key, "1", "EX", 120, "NX");
    return res === "OK";
  } finally {
    await client.quit();
  }
}

export async function clearLorePending(worldId: string, cx: number, cy: number): Promise<void> {
  const key = lorePendingRedisKey(worldId, cx, cy);
  memoryPending.delete(key);
  const url = process.env.REDIS_URL;
  if (!url) return;
  const client = createRedis(url);
  try {
    await client.del(key);
  } finally {
    await client.quit();
  }
}

async function getPlayerDiscoveryCount(playerId: string): Promise<number> {
  const key = lorePlayerDiscoveriesRedisKey(playerId);
  const url = process.env.REDIS_URL;
  if (!url) {
    return memoryDiscoveries.get(playerId) ?? 0;
  }
  const client = createRedis(url);
  try {
    const raw = await client.get(key);
    return raw ? Number.parseInt(raw, 10) || 0 : 0;
  } finally {
    await client.quit();
  }
}

async function incrementPlayerDiscoveryCount(playerId: string): Promise<number> {
  const key = lorePlayerDiscoveriesRedisKey(playerId);
  const url = process.env.REDIS_URL;
  if (!url) {
    const next = (memoryDiscoveries.get(playerId) ?? 0) + 1;
    memoryDiscoveries.set(playerId, next);
    return next;
  }
  const client = createRedis(url);
  try {
    return await client.incr(key);
  } finally {
    await client.quit();
  }
}

/** Test helper */
export function clearLoreOrchestratorMemory(): void {
  memoryPending.clear();
  memoryDiscoveries.clear();
}

export type OnPlayerEnterChunkInput = {
  mapRoomId: string;
  sessionId: string;
  playerId: string;
  cx: number;
  cy: number;
};

export async function onPlayerEnterChunk(input: OnPlayerEnterChunkInput): Promise<void> {
  const { mapRoomId, sessionId, playerId, cx, cy } = input;
  const worldId = mapRoomId;

  if (shouldSkipLoreGeneration(cx, cy)) {
    broadcastLoreSync(
      mapRoomId,
      [
        buildLoreSyncEntry({
          cx,
          cy,
          status: "home",
          lore: HOME_CHUNK_LORE,
        }),
      ],
    );
    return;
  }

  const cached = await getChunkLore(worldId, cx, cy);
  if (cached) {
    broadcastLoreSync(
      mapRoomId,
      [
        buildLoreSyncEntry({
          cx,
          cy,
          status: "ready",
          lore: cached.lore,
        }),
      ],
    );
    return;
  }

  const acquired = await tryAcquirePending(worldId, cx, cy);
  if (!acquired) {
    broadcastLoreSync(
      mapRoomId,
      [buildLoreSyncEntry({ cx, cy, status: "pending" })],
    );
    return;
  }

  const loader = getChunkLoader(mapRoomId);
  const view = loader.getChunkView(cx, cy);
  const tiles = view?.tiles ?? [];
  const dominantBiome = dominantBiomeFromTiles(tiles) as BiomeId;
  const walkableRatio = walkableRatioFromTiles(tiles);
  const discoveryCount = await getPlayerDiscoveryCount(playerId);
  const modelTier = resolveModelTier(discoveryCount);

  await addChunkLoreJob({
    worldId,
    mapRoomId,
    cx,
    cy,
    worldSeed: String(worldSeedFromEnv()),
    dominantBiome,
    walkableRatio,
    modelTier,
    triggerPlayerId: playerId,
  });
  await incrementPlayerDiscoveryCount(playerId);
  incrementLoreEnqueueCounter();

  broadcastLoreSync(
    mapRoomId,
    [
      buildLoreSyncEntry({
        cx,
        cy,
        status: "pending",
        isFirstDiscover: true,
      }),
    ],
    { triggerSessionId: sessionId },
  );
}

export function broadcastLoreReady(
  mapRoomId: string,
  cx: number,
  cy: number,
  lore: ChunkLore,
): void {
  broadcastLoreSync(mapRoomId, [
    buildLoreSyncEntry({ cx, cy, status: "ready", lore }),
  ]);
}

export function broadcastLoreFailed(mapRoomId: string, cx: number, cy: number): void {
  broadcastLoreSync(mapRoomId, [buildLoreSyncEntry({ cx, cy, status: "failed" })]);
}

export function broadcastLoreVoid(mapRoomId: string, cx: number, cy: number): void {
  broadcastLoreSync(mapRoomId, [buildLoreSyncEntry({ cx, cy, status: "void" })]);
}
