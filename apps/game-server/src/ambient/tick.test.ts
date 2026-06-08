import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { createDefaultRoom } from "@aetherlife/shared";
import { clearChunkDeltaMemory } from "../world/chunk-repository.js";
import { ChunkLoader } from "../world/chunk-loader.js";
import { GameRoomState } from "../colyseus/schema.js";
import { runAmbientTick } from "./tick.js";

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
    const waypointCursors = new Map<string, number>();

    runAmbientTick({
      roomId: "tick-wrap",
      gameState,
      map,
      loader,
      npcSpeakJobs: new Map(),
      waypointCursors,
    });

    expect(gameState.gameMinute).toBe(0);
  });

  it("skips npc in npcSpeakJobs only; others still update", async () => {
    const map = createDefaultRoom("tick-speak");
    const gameState = new GameRoomState();
    gameState.gameMinute = 360;
    const loader = await loaderForMap(map);
    const waypointCursors = new Map<string, number>();
    const speakJobs = new Map([["npc-1", "job-1"]]);

    runAmbientTick({
      roomId: "tick-speak",
      gameState,
      map,
      loader,
      npcSpeakJobs: speakJobs,
      waypointCursors,
    });

    expect(map.npcs[0]!.activityKey).toBeUndefined();
    expect(map.npcs[1]!.activityKey).toBeDefined();
    expect(map.npcs[1]!.activityKey).not.toBe("idle");
  });

  it("stationary segment sets activityKey without changing x/y", async () => {
    const map = createDefaultRoom("tick-stationary");
    const gameState = new GameRoomState();
    gameState.gameMinute = 360;
    const npc1 = map.npcs[0]!;
    const startX = npc1.x;
    const startY = npc1.y;
    const loader = await loaderForMap(map);

    runAmbientTick({
      roomId: "tick-stationary",
      gameState,
      map,
      loader,
      npcSpeakJobs: new Map(),
      waypointCursors: new Map(),
    });

    expect(npc1.activityKey).toBe("reading");
    expect(npc1.x).toBe(startX);
    expect(npc1.y).toBe(startY);
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
      waypointCursors: new Map(),
    });

    expect(npc1.activityKey).toBe("patrol");
    const dx = Math.abs(npc1.x - startX);
    const dy = Math.abs(npc1.y - startY);
    expect(dx + dy).toBeLessThanOrEqual(1);
  });

  it("contains no fetch/axios/worker/llm imports (LIFE-03)", () => {
    const code = TICK_SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/\bfetch\s*\(/);
    expect(code).not.toMatch(/\baxios\b/);
    expect(code).not.toMatch(/\bworker\b/);
    expect(code).not.toMatch(/\bopenai\b/i);
    expect(code).not.toMatch(/\bllm\b/i);
  });
});
