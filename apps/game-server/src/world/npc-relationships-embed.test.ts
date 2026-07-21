/**
 * Phase 28 plan 09 — async relationship edge embeddings (D-EMBED-02/03).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMBED_DIMENSIONS } from "@aetherlife/npc-memory";
import { embedText } from "../memory/embed.js";
import {
  applyIdleDecayDeltas,
  applyRelationshipDeltas,
  buildRelationshipEmbedText,
  clearNpcRelationshipsMemory,
  getRelationshipEdgeEmbedding,
  insertRelationshipEdge,
  searchSimilarEdges,
  updateEmbeddingForEdge,
} from "./npc-relationships-repository.js";

describe("relationship edge embed text (D-EMBED-02)", () => {
  it("joins history_summary + current_status without affection/band tokens", () => {
    const text = buildRelationshipEmbedText({
      historySummary: "昔日同盟，共守边境裂隙。",
      currentStatus: ["疏远", "互不往来"],
      affection: -40,
      band: "hostile",
    });
    expect(text).toContain("昔日同盟");
    expect(text).toContain("疏远");
    expect(text).toContain("互不往来");
    expect(text).not.toMatch(/-40/);
    expect(text).not.toContain("hostile");
    expect(text).not.toMatch(/\baffection\b/i);
  });
});

describe("relationship edge embedding write (D-EMBED-03)", () => {
  beforeEach(() => {
    delete process.env.DATABASE_URL;
    process.env.VITEST = "true";
    clearNpcRelationshipsMemory();
  });

  afterEach(() => {
    clearNpcRelationshipsMemory();
  });

  it("updateEmbeddingForEdge stores mock embedText vector (2048 dims)", async () => {
    await insertRelationshipEdge({
      roomId: "room-embed",
      npcAId: "npc-1",
      npcBId: "npc-2",
      baseTag: "ally",
      affection: 60,
      trust: 70,
      historySummary: "并肩作战多年。",
    });

    const text = buildRelationshipEmbedText({
      historySummary: "并肩作战多年。",
      currentStatus: ["亲近"],
    });
    const embedding = await embedText(text);
    expect(embedding).toHaveLength(EMBED_DIMENSIONS);

    await updateEmbeddingForEdge("room-embed", "npc-1", "npc-2", embedding);
    const stored = await getRelationshipEdgeEmbedding("room-embed", "npc-1", "npc-2");
    expect(stored).not.toBeNull();
    expect(stored!).toHaveLength(EMBED_DIMENSIONS);
    expect(stored![0]).toBeCloseTo(embedding[0]!, 5);
  });

  it("applyRelationshipDeltas schedules async embed and updates vector (non-decay)", async () => {
    await insertRelationshipEdge({
      roomId: "room-async",
      npcAId: "npc-3",
      npcBId: "npc-4",
      baseTag: "rival",
      affection: -20,
      trust: 40,
      historySummary: "旧怨未消。",
    });

    await applyRelationshipDeltas({
      roomId: "room-async",
      deltas: [
        {
          npcAId: "npc-3",
          npcBId: "npc-4",
          affectionDelta: -5,
          historyAppend: "又起争执。",
          statusTags: ["交恶"],
        },
      ],
    });

    // Fire-and-forget: flush microtasks / short await
    await vi.waitFor(
      async () => {
        const stored = await getRelationshipEdgeEmbedding("room-async", "npc-3", "npc-4");
        expect(stored).not.toBeNull();
        expect(stored!).toHaveLength(EMBED_DIMENSIONS);
      },
      { timeout: 2000, interval: 20 },
    );
  });

  it("applyIdleDecayDeltas does not embed", async () => {
    await insertRelationshipEdge({
      roomId: "room-decay",
      npcAId: "npc-5",
      npcBId: "npc-6",
      baseTag: "peer",
      affection: 30,
      trust: 50,
      historySummary: "同窗旧友。",
    });

    await applyIdleDecayDeltas({
      roomId: "room-decay",
      deltas: [{ npcAId: "npc-5", npcBId: "npc-6", affectionDelta: -2 }],
    });

    await new Promise((r) => setTimeout(r, 50));
    const stored = await getRelationshipEdgeEmbedding("room-decay", "npc-5", "npc-6");
    expect(stored).toBeNull();
  });

  it("searchSimilarEdges ranks by cosine and prefers query match", async () => {
    await insertRelationshipEdge({
      roomId: "room-sim",
      npcAId: "npc-1",
      npcBId: "npc-2",
      baseTag: "ally",
      affection: 50,
      trust: 60,
      historySummary: "共守封印裂隙，边境防务同盟。",
    });
    await insertRelationshipEdge({
      roomId: "room-sim",
      npcAId: "npc-1",
      npcBId: "npc-3",
      baseTag: "peer",
      affection: 10,
      trust: 50,
      historySummary: "偶尔闲聊天气。",
    });

    const q = await embedText("封印裂隙边境防务");
    await updateEmbeddingForEdge(
      "room-sim",
      "npc-1",
      "npc-2",
      await embedText("共守封印裂隙，边境防务同盟。"),
    );
    await updateEmbeddingForEdge(
      "room-sim",
      "npc-1",
      "npc-3",
      await embedText("偶尔闲聊天气。"),
    );

    const hits = await searchSimilarEdges({
      roomId: "room-sim",
      queryEmbedding: q,
      activeNpcId: "npc-1",
      k: 2,
    });
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0]!.npcAId === "npc-1" || hits[0]!.npcBId === "npc-1").toBe(true);
    expect(hits[0]!.historySummary).toContain("封印");
  });
});
