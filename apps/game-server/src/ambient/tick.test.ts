import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import {
  buildGlobalMoveGrid,
  COUNCIL_NPC_IDS,
  createDefaultRoom,
  parseAmbientIntent,
} from "@aetherlife/shared";
import { GameRoomState } from "../colyseus/schema.js";
import { clearAllIntentsForTests, setIntent } from "./intent-cache.js";
import {
  resolveScheduleSegment,
  shouldSkipMovement,
  type Mobility,
} from "./schedule.js";
import {
  applySoftLeashTarget,
  MAIN_AMBIENT_NPC_IDS,
  pickJoinVicinityTarget,
  runAmbientTick,
  shouldStepThisTick,
  stepPercentForMobility,
} from "./tick.js";
import { clearChunkDeltaMemory } from "../world/chunk-repository.js";
import { ChunkLoader } from "../world/chunk-loader.js";

/** First minute in 0..1439 where the B2 step gate passes (plan 03 integration helper). */
function stepActiveMinute(npcId: string, mobility: Mobility): number {
  for (let m = 0; m < 1440; m++) {
    if (shouldStepThisTick(npcId, m, mobility)) return m;
  }
  throw new Error(`no passing minute for ${npcId}/${mobility} — hash key wrong?`);
}

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

    expect(map.npcs.find((n) => n.id === "npc-1")!.activityKey).toBe("idle");
    expect(map.npcs.find((n) => n.id === "npc-2")!.activityKey).toBeDefined();
    expect(map.npcs.find((n) => n.id === "npc-2")!.activityKey).not.toBe("idle");
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

  it("MAIN_AMBIENT_NPC_IDS covers all 12 council seats", () => {
    expect(MAIN_AMBIENT_NPC_IDS.length).toBe(12);
    expect([...MAIN_AMBIENT_NPC_IDS].sort()).toEqual([...COUNCIL_NPC_IDS].sort());
  });

  it("at least two NPCs move in the same runAmbientTick", async () => {
    clearAllIntentsForTests();
    const map = createDefaultRoom("tick-multi-move");
    const gameState = new GameRoomState();

    let chosenMinute = -1;
    let chosenIds: string[] = [];
    for (let m = 0; m < 1440; m++) {
      const eligible: string[] = [];
      for (const id of COUNCIL_NPC_IDS) {
        const segment = resolveScheduleSegment(id, m);
        if (!segment || shouldSkipMovement(segment)) continue;
        if (!shouldStepThisTick(id, m, segment.mobility)) continue;
        eligible.push(id);
      }
      if (eligible.length >= 2) {
        chosenMinute = m;
        chosenIds = eligible.slice(0, 2);
        break;
      }
    }
    expect(chosenMinute).toBeGreaterThanOrEqual(0);
    expect(chosenIds.length).toBe(2);

    gameState.gameMinute = chosenMinute === 0 ? 1439 : chosenMinute - 1;
    // Park everyone else so they cannot occupy mover targets (MP-07).
    map.player.x = 1;
    map.player.y = 1;
    map.npcs.forEach((npc, i) => {
      if (!chosenIds.includes(npc.id)) {
        npc.x = 2;
        npc.y = 2 + i;
        npc.maxRadius = 40;
      }
    });
    const clearSlots = [
      { x: 20, y: 12 },
      { x: 28, y: 12 },
    ];
    for (let i = 0; i < chosenIds.length; i += 1) {
      const id = chosenIds[i]!;
      const slot = clearSlots[i]!;
      const npc = map.npcs.find((n) => n.id === id)!;
      npc.x = slot.x;
      npc.y = slot.y;
      npc.homeX = slot.x;
      npc.homeY = slot.y;
      npc.maxRadius = 40;
      setIntent("tick-multi-move", id, {
        intent: parseAmbientIntent({
          target: { gx: slot.x + 1, gy: slot.y },
          reasonZh: "去那边",
          untilGameMinute: chosenMinute + 60,
        }),
        trigger: "segment_change",
        gameMinute: chosenMinute,
      });
    }
    const loader = await loaderForMap(map);
    const before = new Map(map.npcs.map((n) => [n.id, { x: n.x, y: n.y }]));

    runAmbientTick({
      roomId: "tick-multi-move",
      gameState,
      map,
      loader,
      npcSpeakJobs: new Map(),
      recentNpcCells: new Map(),
    });

    let movedCount = 0;
    for (const id of chosenIds) {
      const npc = map.npcs.find((n) => n.id === id)!;
      const start = before.get(id)!;
      const moved = npc.x !== start.x || npc.y !== start.y;
      if (moved) {
        movedCount += 1;
        const dx = Math.abs(npc.x - start.x);
        const dy = Math.abs(npc.y - start.y);
        expect(dx + dy).toBeLessThanOrEqual(1);
      }
    }
    expect(movedCount).toBeGreaterThanOrEqual(2);
  });

  it("maxRadius 0 council seats stay at embassy home during ambient tick", async () => {
    clearAllIntentsForTests();
    const map = createDefaultRoom("tick-stationary");
    const gameState = new GameRoomState();
    const stationaryNpc = map.npcs[0]!;
    stationaryNpc.maxRadius = 0;
    let passMinute = -1;
    for (let m = 0; m < 1440; m++) {
      const seg = resolveScheduleSegment(stationaryNpc.id, m);
      if (!seg || shouldSkipMovement(seg)) continue;
      if (shouldStepThisTick(stationaryNpc.id, m, seg.mobility)) {
        passMinute = m;
        break;
      }
    }
    expect(passMinute).toBeGreaterThanOrEqual(0);
    gameState.gameMinute = passMinute === 0 ? 1439 : passMinute - 1;
    setIntent("tick-stationary", stationaryNpc.id, {
      intent: parseAmbientIntent({
        target: { gx: stationaryNpc.x + 20, gy: stationaryNpc.y },
        reasonZh: "想走远一点",
        untilGameMinute: passMinute + 60,
      }),
      trigger: "segment_change",
      gameMinute: passMinute,
    });
    const loader = await loaderForMap(map);
    const before = { x: stationaryNpc.x, y: stationaryNpc.y };

    runAmbientTick({
      roomId: "tick-stationary",
      gameState,
      map,
      loader,
      npcSpeakJobs: new Map(),
      recentNpcCells: new Map(),
    });

    expect(stationaryNpc.x).toBe(before.x);
    expect(stationaryNpc.y).toBe(before.y);
  });

  it("applySoftLeashTarget biases wander target back toward embassy home", () => {
    const npc = {
      id: "npc-7",
      name: "纳兰温言",
      x: 40,
      y: 12,
      homeX: 31,
      homeY: 12,
      maxRadius: 8,
      status: "idle",
      inventory: [],
    };
    const leashed = applySoftLeashTarget(npc, 50, 20);
    expect(leashed).toEqual({ targetGx: 31, targetGy: 12 });
  });

  it("applySoftLeashTarget clamps destination inside embassy radius", () => {
    const npc = {
      id: "npc-7",
      name: "纳兰温言",
      x: 31,
      y: 12,
      homeX: 31,
      homeY: 12,
      maxRadius: 3,
      status: "idle",
      inventory: [],
    };
    const leashed = applySoftLeashTarget(npc, 50, 12);
    const dist = Math.max(Math.abs(leashed.targetGx - 31), Math.abs(leashed.targetGy - 12));
    expect(dist).toBeLessThanOrEqual(3);
    expect(leashed.targetGx).not.toBe(50);
  });

  it("join_vicinity bypasses the step gate and the soft leash (D-11)", async () => {
    clearAllIntentsForTests();
    const map = createDefaultRoom("tick-join-bypass");
    const gameState = new GameRoomState();
    const npc = map.npcs[0]!;
    // Player ~4 cells west on walkable cells; home far so soft leash would pull home.
    npc.x = 32;
    npc.y = 12;
    npc.homeX = 5;
    npc.homeY = 9;
    npc.maxRadius = 2;
    map.player.x = 28;
    map.player.y = 12;
    npc.joinVicinityActive = true;
    npc.joinVicinityStartedAt = Date.now();
    npc.joinVicinityUntil = Date.now() + 8000;

    let failMinute = -1;
    for (let m = 0; m < 1440; m++) {
      const seg = resolveScheduleSegment(npc.id, m);
      if (!seg || shouldSkipMovement(seg)) continue;
      if (!shouldStepThisTick(npc.id, m, seg.mobility)) {
        failMinute = m;
        break;
      }
    }
    expect(failMinute).toBeGreaterThanOrEqual(0);
    gameState.gameMinute = failMinute === 0 ? 1439 : failMinute - 1;

    // Park non-movers; pin diagonals so join target is uniquely (29,12) — first step west.
    map.npcs.forEach((other, i) => {
      if (other.id === npc.id) return;
      if (i === 1) {
        other.x = 29;
        other.y = 11;
      } else if (i === 2) {
        other.x = 29;
        other.y = 13;
      } else {
        other.x = 2;
        other.y = 2 + i;
      }
    });

    const distBefore = Math.max(Math.abs(npc.x - map.player.x), Math.abs(npc.y - map.player.y));
    expect(distBefore).toBeGreaterThan(2);
    const loader = await loaderForMap(map);

    runAmbientTick({
      roomId: "tick-join-bypass",
      gameState,
      map,
      loader,
      npcSpeakJobs: new Map(),
      recentNpcCells: new Map(),
    });

    const distAfter = Math.max(Math.abs(npc.x - map.player.x), Math.abs(npc.y - map.player.y));
    expect(distAfter).toBeLessThan(distBefore);
  });

  it("applySoftLeashTarget never clamps in-region zone targets at radius 40", () => {
    const npc = {
      id: "npc-11",
      name: "test",
      x: 5,
      y: 9,
      homeX: 5,
      homeY: 9,
      maxRadius: 40,
      status: "idle",
      inventory: [],
    };
    const leashed = applySoftLeashTarget(npc, 39, 39);
    expect(leashed).toEqual({ targetGx: 39, targetGy: 39 });
  });

  it("contains no fetch/axios/worker/llm imports (LIFE-03)", () => {
    const code = TICK_SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/\bfetch\s*\(/);
    expect(code).not.toMatch(/\baxios\b/);
    expect(code).not.toMatch(/\bworker\b/);
    expect(code).not.toMatch(/\bopenai\b/i);
    expect(code).not.toMatch(/\bllm\b/i);
    expect(code).not.toMatch(/\bisBackgroundNpc\b/);
    expect(code).not.toMatch(/\brunBackgroundNpcTick\b/);
  });
});

describe("shouldStepThisTick (B2 gate)", () => {
  it("wander gate passes ~55% of minutes (deterministic count)", () => {
    let pass = 0;
    for (let m = 0; m < 1440; m++) {
      if (shouldStepThisTick("npc-3", m, "wander")) pass++;
    }
    const ratio = pass / 1440;
    expect(ratio).toBeGreaterThan(0.5);
    expect(ratio).toBeLessThan(0.6);
    expect(stepActiveMinute("npc-3", "wander")).toBeGreaterThanOrEqual(0);
  });

  it("linger gate passes ~30% of minutes (deterministic count)", () => {
    expect(stepPercentForMobility("wander")).toBe(55);
    expect(stepPercentForMobility("stationary")).toBe(30);
    expect(stepPercentForMobility("poi")).toBe(30);
    let pass = 0;
    for (let m = 0; m < 1440; m++) {
      if (shouldStepThisTick("npc-3", m, "stationary")) pass++;
    }
    const ratio = pass / 1440;
    expect(ratio).toBeGreaterThan(0.25);
    expect(ratio).toBeLessThan(0.35);
  });

  it("multiple NPCs can pass the gate on the same minute (B2, D-22/D-24)", () => {
    let coPassMinutes = 0;
    for (let m = 0; m < 1440; m++) {
      const movers = COUNCIL_NPC_IDS.filter((id) => shouldStepThisTick(id, m, "wander"));
      if (movers.length >= 2) coPassMinutes++;
    }
    expect(coPassMinutes).toBeGreaterThan(0);
  });

  it("per-NPC jitter desynchronizes gate minutes (D-24)", () => {
    let npc1Only = false;
    let npc2Only = false;
    for (let m = 0; m < 1440; m++) {
      const a = shouldStepThisTick("npc-1", m, "wander");
      const b = shouldStepThisTick("npc-2", m, "wander");
      if (a && !b) npc1Only = true;
      if (b && !a) npc2Only = true;
      if (npc1Only && npc2Only) break;
    }
    expect(npc1Only).toBe(true);
    expect(npc2Only).toBe(true);
  });
});
