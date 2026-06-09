import { describe, expect, it, beforeEach } from "vitest";
import { resetChunkRepositoryForTests } from "./chunk-repository.js";
import { ChunkLoader } from "./chunk-loader.js";

describe("ChunkLoader", () => {
  beforeEach(() => {
    delete process.env.DATABASE_URL;
    resetChunkRepositoryForTests();
  });

  it("loads 3x3 window around player", async () => {
    const loader = new ChunkLoader({ worldId: "test", worldSeed: 42, now: () => 1000 });
    await loader.ensureChunksForPlayers([{ gx: 4, gy: 4 }]);
    const views = loader.getLoadedChunkViews();
    expect(views.length).toBe(9);
    expect(loader.getWalkability(4, 4)).toBe(true);
  });

  it("returns void for unloaded cells", () => {
    const loader = new ChunkLoader({ worldId: "test2", worldSeed: 42 });
    expect(loader.getWalkability(40, 40)).toBe("void");
  });

  it("map-test homestead region (24×24) is walkable without loading chunks", () => {
    const loader = new ChunkLoader({ worldId: "test-homemap", worldSeed: 42 });
    expect(loader.getWalkability(10, 10)).toBe(true);
    expect(loader.getWalkability(23, 23)).toBe(true);
    expect(loader.getWalkability(24, 0)).toBe("void");
  });

  it("evicts chunks outside union after TTL", async () => {
    let t = 1000;
    const loader = new ChunkLoader({
      worldId: "test3",
      worldSeed: 42,
      now: () => t,
      ttlMs: 30_000,
    });
    await loader.ensureChunksForPlayers([{ gx: 4, gy: 4 }]);
    expect(loader.getLoadedChunkViews().length).toBe(9);
    await loader.ensureChunksForPlayers([{ gx: 40, gy: 40 }]);
    t += 31_000;
    await loader.ensureChunksForPlayers([{ gx: 40, gy: 40 }]);
    const keys = loader.getLoadedChunkViews().map((c) => `${c.cx},${c.cy}`);
    expect(keys).not.toContain("0,0");
  });

  it("persists and reloads door delta", async () => {
    const loader = new ChunkLoader({ worldId: "test4", worldSeed: 42 });
    await loader.ensureChunksForPlayers([{ gx: 3, gy: 3 }]);
    await loader.persistDelta(0, 0, {
      objects: [{ id: "door-1", kind: "door", x: 3, y: 3, state: "open" }],
    });
    loader.clearCache();
    await loader.ensureChunksForPlayers([{ gx: 3, gy: 3 }]);
    const reloaded = await import("./chunk-repository.js").then((m) =>
      m.loadChunkDelta("test4", 0, 0),
    );
    expect(reloaded?.objects?.[0]?.state).toBe("open");
  });
});
