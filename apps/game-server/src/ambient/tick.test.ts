import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { buildGlobalMoveGrid, createDefaultRoom, parseAmbientIntent } from "@aetherlife/shared";
import { GameRoomState } from "../colyseus/schema.js";
import { clearAllIntentsForTests, setIntent } from "./intent-cache.js";
import { pickJoinVicinityTarget, runAmbientTick } from "./tick.js";
import { clearChunkDeltaMemory } from "../world/chunk-repository.js";
import { ChunkLoader } from "../world/chunk-loader.js";

const TICK_SOURCE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "tick.ts"),
  "utf8",
);

async function loaderForMap(map: ReturnType<typeof createDefaultRoom>) {
  const loader = new ChunkLoader({ worldId: "ambient-tick-test", worldSeed: 42 });
  const positions = map.npcs.map((n) => ({ gx: n.x, gy: n.y }));
  positions.push({ gx: map.player.x, gy: map.player.y });
  await loader.ensureChunksForPlayers(positions);
  return loader;
}

describe("runAmbientTick", () => {
  beforeEach(() => {
    clearChunkDeltaMemory();
  });

  it("increments gameMinute by 1 and wraps at 1440", async () => {
    const map = createDefaultRoom("tick-wrap");
    const gameState = new GameRoomState();
    gameState.gameMinute = 1439;
    const loader = await loaderForMap(map);
    const recentNpcCells = new Map<string, { x: number; y: number }[]>();

    runAmbientTick({
      roomId: "tick-wrap",
      gameState,
      map,
      loader,
      npcSpeakJobs: new Map(),
      recentNpcCells,
    });

    expect(gameState.gameMinute).toBe(0);
  });

  it("skips npc in npcSpeakJobs only; others still update", async () => {
    const map = createDefaultRoom("tick-speak");
    const gameState = new GameRoomState();
    gameState.gameMinute = 360;
    const loader = await loaderForMap(map);
    const recentNpcCells = new Map<string, { x: number; y: number }[]>();
    const speakJobs = new Map([["npc-1", "job-1"]]);

    runAmbientTick({
      roomId: "tick-speak",
      gameState,
      map,
      loader,
      npcSpeakJobs: speakJobs,
      recentNpcCells,
    });

    expect(map.npcs[0]!.activityKey).toBeUndefined();
    expect(map.npcs[1]!.activityKey).toBeDefined();
    expect(map.npcs[1]!.activityKey).not.toBe("idle");
  });

  it("resting segment sets activityKey without changing x/y", async () => {
    const map = createDefaultRoom("tick-resting");
    const gameState = new GameRoomState();
    gameState.gameMinute = 299;
    const npc1 = map.npcs[0]!;
    const startX = npc1.x;
    const startY = npc1.y;
    const loader = await loaderForMap(map);

    runAmbientTick({
      roomId: "tick-resting",
      gameState,
      map,
      loader,
      npcSpeakJobs: new Map(),
      recentNpcCells: new Map(),
    });

    expect(npc1.activityKey).toBe("resting");
    expect(npc1.x).toBe(startX);
    expect(npc1.y).toBe(startY);
  });

  it("stationary reading segment sets activityKey and allows at most one cell step", async () => {
    const map = createDefaultRoom("tick-stationary-linger");
    const gameState = new GameRoomState();
    gameState.gameMinute = 359;
    const npc1 = map.npcs[0]!;
    const startX = npc1.x;
    const startY = npc1.y;
    const loader = await loaderForMap(map);

    runAmbientTick({
      roomId: "tick-stationary-linger",
      gameState,
      map,
      loader,
      npcSpeakJobs: new Map(),
      recentNpcCells: new Map(),
    });

    expect(npc1.activityKey).toBe("reading");
    const dx = Math.abs(npc1.x - startX);
    const dy = Math.abs(npc1.y - startY);
    expect(dx + dy).toBeLessThanOrEqual(1);
  });

  it("patrol segment may change position by at most one cell", async () => {
    const map = createDefaultRoom("tick-patrol");
    const gameState = new GameRoomState();
    gameState.gameMinute = 480;
    const npc1 = map.npcs[0]!;
    const startX = npc1.x;
    const startY = npc1.y;
    const loader = await loaderForMap(map);

    runAmbientTick({
      roomId: "tick-patrol",
      gameState,
      map,
      loader,
      npcSpeakJobs: new Map(),
      recentNpcCells: new Map(),
    });

    expect(npc1.activityKey).toBe("patrol");
    const dx = Math.abs(npc1.x - startX);
    const dy = Math.abs(npc1.y - startY);
    expect(dx + dy).toBeLessThanOrEqual(1);
  });

  it("uses cached target intent for movement and sets intentReasonZh", async () => {
    clearAllIntentsForTests();
    const map = createDefaultRoom("tick-intent");
    const gameState = new GameRoomState();
    gameState.gameMinute = 480;
    const npc1 = map.npcs[0]!;
    const startX = npc1.x;
    const startY = npc1.y;
    const targetGx = startX + 2;
    const targetGy = startY;
    const intent = parseAmbientIntent({
      target: { gx: targetGx, gy: targetGy },
      reasonZh: "去那边",
      untilGameMinute: 720,
    });
    setIntent("tick-intent", "npc-1", {
      intent,
      trigger: "segment_change",
      gameMinute: 480,
    });
    const loader = await loaderForMap(map);

    runAmbientTick({
      roomId: "tick-intent",
      gameState,
      map,
      loader,
      npcSpeakJobs: new Map(),
      recentNpcCells: new Map(),
    });

    expect(npc1.intentReasonZh).toBe("去那边");
    const dx = Math.abs(npc1.x - startX);
    const dy = Math.abs(npc1.y - startY);
    expect(dx + dy).toBeLessThanOrEqual(1);
  });

  it("preserves intentReasonZh on cache miss when already set from segment fallback", async () => {
    clearAllIntentsForTests();
    const map = createDefaultRoom("tick-preserve-reason");
    const gameState = new GameRoomState();
    gameState.gameMinute = 480;
    const npc1 = map.npcs[0]!;
    npc1.intentReasonZh = "心里还惦记着件事";
    const startX = npc1.x;
    const startY = npc1.y;
    const loader = await loaderForMap(map);

    runAmbientTick({
      roomId: "tick-preserve-reason",
      gameState,
      map,
      loader,
      npcSpeakJobs: new Map(),
      recentNpcCells: new Map(),
    });

    expect(npc1.intentReasonZh).toBe("心里还惦记着件事");
    const dx = Math.abs(npc1.x - startX);
    const dy = Math.abs(npc1.y - startY);
    expect(dx + dy).toBeLessThanOrEqual(1);
  });

  it("pickJoinVicinityTarget returns walkable cell adjacent to player", () => {
    const map = createDefaultRoom("tick-join-unit");
    const npc = map.npcs[0]!;
    npc.x = 34;
    npc.y = 12;
    map.player.x = 31;
    map.player.y = 12;
    npc.joinVicinityActive = true;
    npc.joinVicinityStartedAt = Date.now();
    npc.joinVicinityUntil = Date.now() + 8000;
    const grid = buildGlobalMoveGrid({
      homeMap: map,
      otherPlayerCells: [],
      isTerrainWalkable: () => true,
    });
    const target = pickJoinVicinityTarget(npc, "tick-join-unit", [{ x: 31, y: 12 }], grid);
    expect(target).not.toBeNull();
    expect(Math.max(Math.abs(target!.x - 31), Math.abs(target!.y - 12))).toBe(1);
    expect(Math.max(Math.abs(npc.x - target!.x), Math.abs(npc.y - target!.y))).toBeLessThan(
      Math.max(Math.abs(npc.x - 31), Math.abs(npc.y - 12)),
    );
  });

  it("contains no fetch/axios/worker/llm imports (LIFE-03)", () => {
    const code = TICK_SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/\bfetch\s*\(/);
    expect(code).not.toMatch(/\baxios\b/);
    expect(code).not.toMatch(/\bworker\b/);
    expect(code).not.toMatch(/\bopenai\b/i);
    expect(code).not.toMatch(/\bllm\b/i);
  });

  it("moves background NPC with wandering activity (no intent)", async () => {
    const map = createDefaultRoom("tick-bg");
    const gameState = new GameRoomState();
    gameState.gameMinute = 400;
    const bg = map.npcs.find((n) => n.id === "bg-villager-1")!;
    const startX = bg.x;
    const startY = bg.y;
    const loader = await loaderForMap(map);

    runAmbientTick({
      roomId: "tick-bg",
      gameState,
      map,
      loader,
      npcSpeakJobs: new Map(),
      recentNpcCells: new Map(),
    });

    expect(bg.activityKey).toBe("wandering");
    expect(bg.intentReasonZh ?? "").toBe("");
    const dx = Math.abs(bg.x - startX);
    const dy = Math.abs(bg.y - startY);
    expect(dx + dy).toBeLessThanOrEqual(1);
  });
});
