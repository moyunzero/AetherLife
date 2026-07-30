import { describe, expect, it } from "vitest";
import {
  PROPAGATION_FRACTION,
  PROPAGATION_MAX_ABS,
  PROPAGATION_MAX_FANOUT,
  PROPAGATION_MIN_AFFECTION,
  PROPAGATION_MIN_EVENT,
  computeRelationshipPropagationDeltas,
  type PropagationEdge,
} from "./relationshipPropagation.js";

function edge(
  npcAId: string,
  npcBId: string,
  baseTag: string,
  affection: number,
): PropagationEdge {
  return {
    npcAId,
    npcBId,
    baseTag,
    affection,
    trust: 50,
    interactionCount: 0,
    lastInteractAt: null,
    currentStatus: [],
    historySummary: "",
    updatedAt: new Date().toISOString(),
  };
}

describe("PROPAGATION constants (D-PROP-10)", () => {
  it("locks exact numeric values", () => {
    expect(PROPAGATION_FRACTION).toBe(0.3);
    expect(PROPAGATION_MIN_AFFECTION).toBe(30);
    expect(PROPAGATION_MAX_FANOUT).toBe(3);
    expect(PROPAGATION_MIN_EVENT).toBe(5);
    expect(PROPAGATION_MAX_ABS).toBe(5);
  });
});

describe("computeRelationshipPropagationDeltas", () => {
  it("friend edge keeps same sign", () => {
    const updates = computeRelationshipPropagationDeltas({
      targetNpcId: "npc-1",
      eventDelta: -8,
      playerIds: ["p-a"],
      edges: [edge("npc-1", "npc-friend", "ally", 50)],
      alreadyUpdated: new Set(["npc-1"]),
    });
    // Math.round(-8 * 0.3) = -2
    expect(updates).toEqual([{ npcId: "npc-friend", playerId: "p-a", delta: -2 }]);
  });

  it("rival/enemy baseTag inverts sign", () => {
    const updates = computeRelationshipPropagationDeltas({
      targetNpcId: "npc-1",
      eventDelta: -8,
      playerIds: ["p-a"],
      edges: [edge("npc-1", "npc-rival", "rival", -50)],
      alreadyUpdated: new Set(["npc-1"]),
    });
    expect(updates).toEqual([{ npcId: "npc-rival", playerId: "p-a", delta: 2 }]);

    const enemy = computeRelationshipPropagationDeltas({
      targetNpcId: "npc-1",
      eventDelta: 10,
      playerIds: ["p-a"],
      edges: [edge("npc-enemy", "npc-1", "nemesis", -80)],
      alreadyUpdated: new Set(["npc-1"]),
    });
    // Math.round(10 * 0.3) = 3 → invert → -3
    expect(enemy).toEqual([{ npcId: "npc-enemy", playerId: "p-a", delta: -3 }]);
  });

  it("skips |eventDelta| < MIN_EVENT", () => {
    const updates = computeRelationshipPropagationDeltas({
      targetNpcId: "npc-1",
      eventDelta: 4,
      playerIds: ["p-a"],
      edges: [edge("npc-1", "npc-friend", "ally", 50)],
      alreadyUpdated: new Set(["npc-1"]),
    });
    expect(updates).toEqual([]);
  });

  it("skips edges below MIN_AFFECTION (|affection|)", () => {
    const updates = computeRelationshipPropagationDeltas({
      targetNpcId: "npc-1",
      eventDelta: -8,
      playerIds: ["p-a"],
      edges: [edge("npc-1", "npc-weak", "ally", 29)],
      alreadyUpdated: new Set(["npc-1"]),
    });
    expect(updates).toEqual([]);
  });

  it("caps fanout at MAX_FANOUT by |affection|", () => {
    const edges = [
      edge("npc-1", "n1", "ally", 90),
      edge("npc-1", "n2", "ally", 80),
      edge("npc-1", "n3", "ally", 70),
      edge("npc-1", "n4", "ally", 60),
    ];
    const updates = computeRelationshipPropagationDeltas({
      targetNpcId: "npc-1",
      eventDelta: -10,
      playerIds: ["p-a"],
      edges,
      alreadyUpdated: new Set(["npc-1"]),
    });
    expect(updates).toHaveLength(3);
    const ids = updates.map((u) => u.npcId);
    expect(ids).toEqual(["n1", "n2", "n3"]);
    expect(ids).not.toContain("n4");
  });

  it("excludes alreadyUpdated witness set", () => {
    const updates = computeRelationshipPropagationDeltas({
      targetNpcId: "npc-1",
      eventDelta: -8,
      playerIds: ["p-a"],
      edges: [
        edge("npc-1", "npc-witness", "ally", 50),
        edge("npc-1", "npc-offscreen", "ally", 40),
      ],
      alreadyUpdated: new Set(["npc-1", "npc-witness"]),
    });
    expect(updates).toEqual([{ npcId: "npc-offscreen", playerId: "p-a", delta: -2 }]);
  });

  it("clamps abs delta to MAX_ABS", () => {
    const updates = computeRelationshipPropagationDeltas({
      targetNpcId: "npc-1",
      eventDelta: -20,
      playerIds: ["p-a"],
      edges: [edge("npc-1", "npc-friend", "ally", 50)],
      alreadyUpdated: new Set(["npc-1"]),
    });
    // Math.round(-20 * 0.3) = -6 → clamp to -5
    expect(updates).toEqual([{ npcId: "npc-friend", playerId: "p-a", delta: -5 }]);
  });

  it("emits one update per playerId", () => {
    const updates = computeRelationshipPropagationDeltas({
      targetNpcId: "npc-1",
      eventDelta: 6,
      playerIds: ["p-a", "p-b"],
      edges: [edge("npc-1", "npc-friend", "ally", 50)],
      alreadyUpdated: new Set(["npc-1"]),
    });
    expect(updates).toEqual([
      { npcId: "npc-friend", playerId: "p-a", delta: 2 },
      { npcId: "npc-friend", playerId: "p-b", delta: 2 },
    ]);
  });

  it("skips unknown / non friend-rival baseTags", () => {
    const updates = computeRelationshipPropagationDeltas({
      targetNpcId: "npc-1",
      eventDelta: -8,
      playerIds: ["p-a"],
      edges: [edge("npc-1", "npc-peer", "peer", 50)],
      alreadyUpdated: new Set(["npc-1"]),
    });
    expect(updates).toEqual([]);
  });
});
