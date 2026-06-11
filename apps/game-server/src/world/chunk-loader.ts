import {
  CHUNK_SIZE,
  chunkKey,
  chunkOf,
  createDefaultRoom,
  type ChunkDelta,
  type ChunkTileView,
  type ChunkView,
  type RoomState,
} from "@aetherlife/shared";
import { loadChunkDelta, saveChunkDelta } from "./chunk-repository.js";
import { mergeHomeChunkBase } from "./home-merge.js";
import { generateChunkBase } from "./noise.js";
import { regionWalkabilityAt } from "./region-walkability.js";
import { worldSeedFromEnv } from "./seed.js";

export type ChunkCacheEntry = {
  cx: number;
  cy: number;
  tiles: ChunkTileView[];
  ready: boolean;
  lastAccess: number;
  delta: ChunkDelta;
  /** False until DB delta merge completes (walkability uses procedural base until then). */
  deltaHydrated: boolean;
};

export type PlayerGlobalPos = { gx: number; gy: number };

export type ChunkLoaderOptions = {
  worldId?: string;
  worldSeed?: number;
  now?: () => number;
  ttlMs?: number;
};

const DEFAULT_TTL_MS = 30_000;

function applyDeltaToTiles(
  baseTiles: ChunkTileView[],
  delta: ChunkDelta,
): ChunkTileView[] {
  const map = new Map(baseTiles.map((t) => [`${t.lx},${t.ly}`, { ...t }]));
  for (const patch of delta.tiles ?? []) {
    const k = `${patch.lx},${patch.ly}`;
    const cur = map.get(k);
    if (!cur) continue;
    if (patch.walkable !== undefined) cur.walkable = patch.walkable;
    if (patch.biome !== undefined) cur.biome = patch.biome;
  }
  return [...map.values()];
}

function chunksInWindow(gx: number, gy: number): Array<{ cx: number; cy: number }> {
  const { cx, cy } = chunkOf(gx, gy);
  const out: Array<{ cx: number; cy: number }> = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      out.push({ cx: cx + dx, cy: cy + dy });
    }
  }
  const lx = ((gx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
  const ly = ((gy % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
  const nearEdge = lx <= 1 || lx >= CHUNK_SIZE - 2 || ly <= 1 || ly >= CHUNK_SIZE - 2;
  if (nearEdge) {
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) continue;
        if (Math.abs(dx) === 2 || Math.abs(dy) === 2) {
          out.push({ cx: cx + dx, cy: cy + dy });
        }
      }
    }
  }
  return out;
}

export class ChunkLoader {
  private readonly worldId: string;
  private readonly worldSeed: number;
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly cache = new Map<string, ChunkCacheEntry>();
  private readonly defaultRoom: RoomState;

  constructor(options: ChunkLoaderOptions = {}) {
    this.worldId = options.worldId ?? "default";
    this.worldSeed = options.worldSeed ?? worldSeedFromEnv();
    this.now = options.now ?? (() => Date.now());
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.defaultRoom = createDefaultRoom(this.worldId);
  }

  private proceduralBaseTiles(cx: number, cy: number): ChunkTileView[] {
    let raw = generateChunkBase(cx, cy, this.worldSeed);
    if (cx === 0 && cy === 0) {
      raw = mergeHomeChunkBase(raw, this.defaultRoom);
    }
    return raw.tiles.map((t) => ({
      lx: t.lx,
      ly: t.ly,
      biome: t.biome,
      walkable: t.walkable,
    }));
  }

  /** Sync procedural tiles — no DB wait (move path must not block on Postgres). */
  private ensureProceduralEntry(cx: number, cy: number): ChunkCacheEntry {
    const k = chunkKey(cx, cy);
    const existing = this.cache.get(k);
    if (existing) {
      existing.lastAccess = this.now();
      return existing;
    }
    const entry: ChunkCacheEntry = {
      cx,
      cy,
      tiles: this.proceduralBaseTiles(cx, cy),
      ready: true,
      lastAccess: this.now(),
      delta: {},
      deltaHydrated: false,
    };
    this.cache.set(k, entry);
    void this.hydrateDelta(cx, cy);
    return entry;
  }

  private async hydrateDelta(cx: number, cy: number): Promise<void> {
    const k = chunkKey(cx, cy);
    const entry = this.cache.get(k);
    if (!entry || entry.deltaHydrated) return;
    const delta = (await loadChunkDelta(this.worldId, cx, cy)) ?? {};
    entry.delta = { ...delta };
    entry.tiles = applyDeltaToTiles(entry.tiles, delta);
    entry.deltaHydrated = true;
  }

  private async loadChunk(cx: number, cy: number): Promise<ChunkCacheEntry> {
    const entry = this.ensureProceduralEntry(cx, cy);
    if (!entry.deltaHydrated) {
      await this.hydrateDelta(cx, cy);
    }
    return this.cache.get(chunkKey(cx, cy))!;
  }

  async ensureChunksForPlayers(positions: readonly PlayerGlobalPos[]): Promise<void> {
    const needed = new Set<string>();
    for (const p of positions) {
      for (const c of chunksInWindow(p.gx, p.gy)) {
        needed.add(chunkKey(c.cx, c.cy));
      }
    }
    for (const k of needed) {
      if (!this.cache.has(k)) {
        const [cx, cy] = k.split(",").map(Number) as [number, number];
        this.ensureProceduralEntry(cx, cy);
      } else {
        const e = this.cache.get(k)!;
        e.lastAccess = this.now();
      }
    }
    this.evictOutside(needed);
  }

  private evictOutside(needed: Set<string>): void {
    const t = this.now();
    for (const [k, e] of this.cache) {
      if (needed.has(k)) continue;
      if (t - e.lastAccess > this.ttlMs) {
        this.cache.delete(k);
      }
    }
  }

  getWalkability(gx: number, gy: number): boolean | "void" {
    const regionWalk = regionWalkabilityAt(gx, gy);
    if (regionWalk !== undefined) return regionWalk;

    const { cx, cy } = chunkOf(gx, gy);
    const entry = this.cache.get(chunkKey(cx, cy));
    if (!entry || !entry.ready) return "void";
    entry.lastAccess = this.now();
    const lx = ((gx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const ly = ((gy % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const tile = entry.tiles.find((t) => t.lx === lx && t.ly === ly);
    if (!tile) return "void";
    return tile.walkable;
  }

  getChunkView(cx: number, cy: number): ChunkView | undefined {
    const entry = this.cache.get(chunkKey(cx, cy));
    if (!entry || !entry.ready) return undefined;
    entry.lastAccess = this.now();
    return { cx: entry.cx, cy: entry.cy, tiles: entry.tiles };
  }

  getLoadedChunkViews(): ChunkView[] {
    return [...this.cache.values()]
      .filter((e) => e.ready)
      .map((e) => ({ cx: e.cx, cy: e.cy, tiles: e.tiles }));
  }

  getBiomeAt(gx: number, gy: number): string | "void" {
    const { cx, cy } = chunkOf(gx, gy);
    const entry = this.cache.get(chunkKey(cx, cy));
    if (!entry) return "void";
    const lx = ((gx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const ly = ((gy % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const tile = entry.tiles.find((t) => t.lx === lx && t.ly === ly);
    return tile?.biome ?? "void";
  }

  async persistDelta(cx: number, cy: number, patch: ChunkDelta): Promise<void> {
    const k = chunkKey(cx, cy);
    let entry = this.cache.get(k);
    if (!entry) {
      entry = await this.loadChunk(cx, cy);
    }
    const merged: ChunkDelta = {
      tiles: [...(entry.delta.tiles ?? [])],
      objects: patch.objects ?? entry.delta.objects,
    };
    for (const t of patch.tiles ?? []) {
      const idx = merged.tiles!.findIndex((x) => x.lx === t.lx && x.ly === t.ly);
      if (idx >= 0) merged.tiles![idx] = { ...merged.tiles![idx], ...t };
      else merged.tiles!.push(t);
    }
    entry.delta = merged;
    entry.tiles = applyDeltaToTiles(entry.tiles, merged);
    await saveChunkDelta(this.worldId, cx, cy, merged);
  }

  /** Force reload from DB (verify / tests). */
  async reloadChunk(cx: number, cy: number): Promise<void> {
    this.cache.delete(chunkKey(cx, cy));
    await this.loadChunk(cx, cy);
  }

  clearCache(): void {
    this.cache.clear();
  }
}

const loaders = new Map<string, ChunkLoader>();

export function getChunkLoader(worldId = "default"): ChunkLoader {
  let loader = loaders.get(worldId);
  if (!loader) {
    loader = new ChunkLoader({ worldId });
    loaders.set(worldId, loader);
  }
  return loader;
}

export function resetChunkLoaders(): void {
  loaders.clear();
}
