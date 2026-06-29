import { beforeEach, describe, expect, it } from "vitest";
import { COUNCIL_NPC_IDS, councilIndexEdgeIds, getPersona, normalizeEdgeIds } from "@aetherlife/shared";
import {
  applyRelationshipDeltas,
  clearNpcRelationshipsMemory,
  councilRelationshipPairCount,
  countRelationshipsForRoom,
  getRelationshipEdge,
  insertRelationshipEdge,
  listRelationshipsForRoom,
} from "./npc-relationships-repository.js";

describe("npc-relationships-repository", () => {
  beforeEach(() => {
    delete process.env.DATABASE_URL;
    clearNpcRelationshipsMemory();
  });

  it("inserts undirected edges with lexicographic npc_a < npc_b", async () => {
    await insertRelationshipEdge({
      roomId: "room-edge",
      npcAId: "npc-12",
      npcBId: "npc-1",
      baseTag: "rival",
      affection: -50,
      trust: 0,
    });

    const edge = await getRelationshipEdge("room-edge", "npc-1", "npc-12");
    expect(edge).not.toBeNull();
    expect(edge!.npcAId).toBe("npc-1");
    expect(edge!.npcBId).toBe("npc-12");
    expect(edge!.baseTag).toBe("rival");
    expect(edge!.affection).toBe(-50);
  });

  it("listRelationshipsForRoom filters by npcId and sorts by abs affection", async () => {
    await insertRelationshipEdge({
      roomId: "room-filter",
      npcAId: "npc-1",
      npcBId: "npc-2",
      baseTag: "rival",
      affection: -50,
      trust: 0,
    });
    await insertRelationshipEdge({
      roomId: "room-filter",
      npcAId: "npc-1",
      npcBId: "npc-3",
      baseTag: "respect",
      affection: 20,
      trust: 70,
    });
    await insertRelationshipEdge({
      roomId: "room-filter",
      npcAId: "npc-1",
      npcBId: "npc-4",
      baseTag: "nemesis",
      affection: -90,
      trust: 10,
    });

    const top2 = await listRelationshipsForRoom("room-filter", { npcId: "npc-1", limit: 2 });
    expect(top2).toHaveLength(2);
    expect(top2[0]!.affection).toBe(-90);
    expect(top2[1]!.affection).toBe(-50);
  });

  it("applyRelationshipDeltas clamps affection and returns linkedEdges", async () => {
    await insertRelationshipEdge({
      roomId: "room-delta",
      npcAId: "npc-1",
      npcBId: "npc-2",
      baseTag: "ally",
      affection: 90,
      trust: 95,
    });

    const result = await applyRelationshipDeltas({
      roomId: "room-delta",
      deltas: [
        {
          npcAId: "npc-2",
          npcBId: "npc-1",
          affectionDelta: 20,
        },
      ],
      voteEpoch: "vote-1",
    });

    expect(result.linkedEdges).toEqual([{ npcAId: "npc-1", npcBId: "npc-2" }]);
    const edge = await getRelationshipEdge("room-delta", "npc-1", "npc-2");
    expect(edge!.affection).toBe(100);
  });

  it("applyRelationshipDeltas caps single delta magnitude at 15", async () => {
    await insertRelationshipEdge({
      roomId: "room-cap",
      npcAId: "npc-5",
      npcBId: "npc-6",
      baseTag: "peer",
      affection: 0,
      trust: 50,
    });

    await applyRelationshipDeltas({
      roomId: "room-cap",
      deltas: [{ npcAId: "npc-5", npcBId: "npc-6", affectionDelta: -40 }],
    });

    const edge = await getRelationshipEdge("room-cap", "npc-5", "npc-6");
    expect(edge!.affection).toBe(-15);
  });

  it("councilRelationshipPairCount is 66 for 12 seats", () => {
    expect(councilRelationshipPairCount()).toBe(66);
    expect(COUNCIL_NPC_IDS).toHaveLength(12);
  });
});

describe("registry-backed edge normalization", () => {
  it("normalizeEdgeIds matches repository storage for all council pairs", () => {
    for (let i = 0; i < COUNCIL_NPC_IDS.length; i++) {
      for (let j = i + 1; j < COUNCIL_NPC_IDS.length; j++) {
        const a = COUNCIL_NPC_IDS[i]!;
        const b = COUNCIL_NPC_IDS[j]!;
        const normalized = normalizeEdgeIds(a, b);
        expect(normalized.npcAId < normalized.npcBId).toBe(true);
        const councilOrder = councilIndexEdgeIds(a, b);
        const persona = getPersona(councilOrder.npcAId);
        const rel = persona.relationships.find((r) => r.targetId === councilOrder.npcBId);
        expect(rel?.kind).toBeTruthy();
      }
    }
  });
});
