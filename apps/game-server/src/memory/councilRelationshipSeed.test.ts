import { beforeEach, describe, expect, it } from "vitest";
import {
  COUNCIL_NPC_IDS,
  councilIndexEdgeIds,
  getPersona,
  normalizeEdgeIds,
} from "@aetherlife/shared";
import {
  clearCouncilRelationshipSeedCache,
  seedCouncilRelationshipsIfNeeded,
} from "./councilRelationshipSeed.js";
import {
  clearNpcRelationshipsMemory,
  countRelationshipsForRoom,
  councilRelationshipPairCount,
  listRelationshipsForRoom,
} from "../world/npc-relationships-repository.js";

describe("seedCouncilRelationshipsIfNeeded", () => {
  beforeEach(() => {
    delete process.env.DATABASE_URL;
    clearNpcRelationshipsMemory();
    clearCouncilRelationshipSeedCache();
  });

  it("inserts 66 edges for a fresh room from registry", async () => {
    await seedCouncilRelationshipsIfNeeded("room-rel-seed");

    expect(await countRelationshipsForRoom("room-rel-seed")).toBe(66);
    expect(councilRelationshipPairCount()).toBe(66);

    const edges = await listRelationshipsForRoom("room-rel-seed");
    expect(edges).toHaveLength(66);

    for (const edge of edges) {
      expect(edge.npcAId < edge.npcBId).toBe(true);
      expect(COUNCIL_NPC_IDS).toContain(edge.npcAId);
      expect(COUNCIL_NPC_IDS).toContain(edge.npcBId);
      expect(edge.baseTag.length).toBeGreaterThan(0);
    }
  });

  it("maps registry kind to initial affection for npc-1 vs npc-4 nemesis", async () => {
    await seedCouncilRelationshipsIfNeeded("room-nemesis");

    const normalized = normalizeEdgeIds("npc-1", "npc-4");
    const edges = await listRelationshipsForRoom("room-nemesis");
    const edge = edges.find(
      (e) => e.npcAId === normalized.npcAId && e.npcBId === normalized.npcBId,
    );
    expect(edge).toBeDefined();
    const councilOrder = councilIndexEdgeIds("npc-1", "npc-4");
    const rel = getPersona(councilOrder.npcAId).relationships.find(
      (r) => r.targetId === councilOrder.npcBId,
    );
    expect(edge!.baseTag).toBe(rel!.kind);
  });

  it("includes edges beyond npc-1..3 (npc-7 vs npc-11)", async () => {
    await seedCouncilRelationshipsIfNeeded("room-beyond-trio");

    const normalized = normalizeEdgeIds("npc-7", "npc-11");
    const councilOrder = councilIndexEdgeIds("npc-7", "npc-11");
    const rel = getPersona(councilOrder.npcAId).relationships.find(
      (r) => r.targetId === councilOrder.npcBId,
    );
    expect(rel).toBeDefined();

    const edge = await listRelationshipsForRoom("room-beyond-trio").then((rows) =>
      rows.find((e) => e.npcAId === normalized.npcAId && e.npcBId === normalized.npcBId),
    );
    expect(edge?.baseTag).toBe(rel!.kind);
  });

  it("second call does not duplicate rows", async () => {
    await seedCouncilRelationshipsIfNeeded("room-idempotent-rel");
    await seedCouncilRelationshipsIfNeeded("room-idempotent-rel");

    expect(await countRelationshipsForRoom("room-idempotent-rel")).toBe(66);
    const edges = await listRelationshipsForRoom("room-idempotent-rel");
    expect(edges).toHaveLength(66);
  });
});
