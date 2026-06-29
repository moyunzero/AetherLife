import { describe, expect, it } from "vitest";
import { COUNCIL_NPC_IDS } from "./council/constants.js";
import { personalitySeedForNpc as councilPersonalitySeedForNpc } from "./council/personalitySeed.js";
import {
  COLLECTIVE_EVENT_KINDS,
  computeEffectiveScore,
  computeWitnessDeltas,
  fixedDeltaForKind,
  KIND_FIXED_DELTA,
  LOUD_KINDS,
  NPC_PERSONALITY_SEED,
  parseCollectiveEvent,
  personalitySeedForNpc,
  safeParseCollectiveEvent,
} from "./collectiveMemory.js";

describe("COLLECTIVE_EVENT_KINDS", () => {
  it("defines 12 MVP kinds with fixed deltas", () => {
    expect(COLLECTIVE_EVENT_KINDS).toHaveLength(12);
    for (const kind of COLLECTIVE_EVENT_KINDS) {
      expect(typeof KIND_FIXED_DELTA[kind]).toBe("number");
    }
  });

  it("marks loud conflict kinds", () => {
    expect(LOUD_KINDS.has("rude")).toBe(true);
    expect(LOUD_KINDS.has("help")).toBe(false);
  });
});

describe("personalitySeedForNpc (D-COLLECTIVE-01)", () => {
  it("returns negative seed for npc-1 (against + order_keeper)", () => {
    expect(personalitySeedForNpc("npc-1")).toBeLessThan(0);
    expect(personalitySeedForNpc("npc-1")).toBe(-52);
  });

  it("returns positive seed for npc-2 (for + expansionist)", () => {
    expect(personalitySeedForNpc("npc-2")).toBeGreaterThan(0);
    expect(personalitySeedForNpc("npc-2")).toBe(58);
  });

  it("covers all 12 council ids within -100..100", () => {
    for (const id of COUNCIL_NPC_IDS) {
      const seed = personalitySeedForNpc(id);
      expect(seed).toBeGreaterThanOrEqual(-100);
      expect(seed).toBeLessThanOrEqual(100);
    }
  });

  it("produces non-uniform seeds across 12 seats (D-COLLECTIVE-02)", () => {
    const values = COUNCIL_NPC_IDS.map((id) => personalitySeedForNpc(id));
    expect(new Set(values).size).toBeGreaterThan(1);
    expect(new Set(values).size).toBe(12);
  });

  it("returns 0 for non-council npc ids", () => {
    expect(personalitySeedForNpc("bg-villager-1")).toBe(0);
  });

  it("re-exports match council module", () => {
    for (const id of COUNCIL_NPC_IDS) {
      expect(personalitySeedForNpc(id)).toBe(councilPersonalitySeedForNpc(id));
    }
  });
});

describe("NPC_PERSONALITY_SEED", () => {
  it("has 12 registry-derived entries matching personalitySeedForNpc", () => {
    expect(Object.keys(NPC_PERSONALITY_SEED)).toHaveLength(12);
    for (const id of COUNCIL_NPC_IDS) {
      expect(NPC_PERSONALITY_SEED[id]).toBe(personalitySeedForNpc(id));
    }
  });
});

describe("computeEffectiveScore", () => {
  it("applies D-16 formula and clamp", () => {
    expect(computeEffectiveScore(0, [-10, 10])).toBe(0);
    expect(computeEffectiveScore(90, [10, 10, 10])).toBe(93);
    expect(computeEffectiveScore(97, [10, 10, 10])).toBe(100);
    expect(computeEffectiveScore(-90, [-40, -40, -40])).toBe(-100);
  });
});

describe("computeWitnessDeltas", () => {
  it("applies 30% to loud kinds within Chebyshev 2", () => {
    const positions = new Map([
      ["npc-1", { x: 2, y: 2 }],
      ["npc-2", { x: 4, y: 2 }],
      ["npc-3", { x: 8, y: 8 }],
    ]);
    const updates = computeWitnessDeltas(
      { kind: "rude", deltaScore: -8, playerIds: ["p-a"] },
      "npc-1",
      positions,
    );
    expect(updates).toContainEqual({ npcId: "npc-1", playerId: "p-a", delta: -8 });
    expect(updates).toContainEqual({ npcId: "npc-2", playerId: "p-a", delta: -2 });
    expect(updates.some((u) => u.npcId === "npc-3")).toBe(false);
  });

  it("skips witness spread for quiet kinds", () => {
    const positions = new Map([
      ["npc-1", { x: 2, y: 2 }],
      ["npc-2", { x: 3, y: 2 }],
    ]);
    const updates = computeWitnessDeltas(
      { kind: "help", deltaScore: 6, playerIds: ["p-a"] },
      "npc-1",
      positions,
    );
    expect(updates).toEqual([{ npcId: "npc-1", playerId: "p-a", delta: 6 }]);
  });
});

describe("parseCollectiveEvent", () => {
  it("accepts valid payloads", () => {
    const parsed = parseCollectiveEvent({
      roomId: "r1",
      npcId: "npc-1",
      kind: "rude",
      summary: "玩家A对莫玄虚出言不逊",
      playerIds: ["p-a", "p-b"],
      deltaScore: fixedDeltaForKind("rude"),
    });
    expect(parsed.kind).toBe("rude");
  });

  it("rejects invalid kind", () => {
    expect(
      safeParseCollectiveEvent({
        roomId: "r1",
        npcId: "npc-1",
        kind: "unknown",
        summary: "x",
        playerIds: ["p-a"],
        deltaScore: 1,
      }).success,
    ).toBe(false);
  });
});
