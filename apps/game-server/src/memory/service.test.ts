import { beforeEach, describe, expect, it } from "vitest";
import { COUNCIL_MEMORY_PLAYER_ID } from "@aetherlife/shared";
import { CollectiveRepository, EMBED_DIMENSIONS } from "@aetherlife/npc-memory";
import { CollectiveService } from "../collective/service.js";
import { MemoryService } from "./service.js";

function unitEmbedding(): number[] {
  const emb = new Array(EMBED_DIMENSIONS).fill(0);
  emb[0] = 1;
  return emb;
}

describe("MemoryService council scope guards", () => {
  beforeEach(() => {
    delete process.env.DATABASE_URL;
    MemoryService.resetForTests();
    CollectiveService.resetForTests(new CollectiveRepository(null));
  });

  it("buildMemoryContext rejects __council__ playerId", async () => {
    const service = MemoryService.getInstance();
    await expect(
      service.buildMemoryContext("room", "hello", "npc-1", COUNCIL_MEMORY_PLAYER_ID),
    ).rejects.toThrow(/__council__/);
  });

  it("buildCouncilMemoryContext reads __council__ scope", async () => {
    const service = MemoryService.getInstance();
    await service.appendNpcMemory(
      "room",
      "council manifesto",
      "npc-1",
      COUNCIL_MEMORY_PLAYER_ID,
      9,
    );

    const ctx = await service.buildCouncilMemoryContext("room", "npc-1", "manifesto", {
      skipEmbed: true,
    });
    expect(ctx.memoryCount).toBe(1);
  });

  it("appendCouncilVoteMemories writes 11 council ballots in one call", async () => {
    const service = MemoryService.getInstance();
    const ballots = Array.from({ length: 11 }, (_, index) => ({
      npcId: `npc-${index + 2}`,
      vote: index % 2 === 0 ? "yes" : "no",
      reasonZh: `理由${index + 2}`,
    }));

    const result = await service.appendCouncilVoteMemories("room-vote", ballots);
    expect(result.count).toBe(11);

    for (const ballot of ballots) {
      const count = await service.getMemoryCount(
        "room-vote",
        ballot.npcId,
        COUNCIL_MEMORY_PLAYER_ID,
      );
      expect(count).toBe(1);
    }
  });

  it("buildCouncilMemoryContext surfaces recent vote memories without query embed", async () => {
    const service = MemoryService.getInstance();
    await service.appendCouncilVoteMemories("room-recent", [
      { npcId: "npc-1", vote: "yes", reasonZh: "秩序优先" },
    ]);

    const ctx = await service.buildCouncilMemoryContext("room-recent", "npc-1", "议会", {
      skipEmbed: true,
    });
    expect(ctx.retrieved.some((row) => row.text.includes("廷议表决"))).toBe(true);
  });

  it("councilRecentAsRetrieved keeps fixed 0.55 × importanceFactor scoring (D-DECAY-05)", async () => {
    const service = MemoryService.getInstance();
    await service.appendCouncilVoteMemories("room-score", [
      { npcId: "npc-1", vote: "yes", reasonZh: "秩序优先" },
    ]);

    const ctx = await service.buildCouncilMemoryContext("room-score", "npc-1", "议会", {
      skipEmbed: true,
    });
    const vote = ctx.retrieved.find((row) => row.text.includes("廷议表决"));
    expect(vote).toBeDefined();
    const importance = 0.6;
    expect(vote!.score).toBeCloseTo(0.55 * (0.5 + importance / 20), 10);
  });
});

describe("TestMemoryBackend forgetting-curve parity (D-DECAY-06)", () => {
  beforeEach(() => {
    delete process.env.DATABASE_URL;
    MemoryService.resetForTests();
    CollectiveService.resetForTests(new CollectiveRepository(null));
  });

  it("applies forgetting curve so fresher mid-importance beats stale high-importance", async () => {
    const service = MemoryService.getInstance();
    const emb = unitEmbedding();
    const now = Date.now();

    // Without recency, importance 10 (factor 1.0) would beat importance 5 (0.75).
    // With floor 0.3, stale score ≤ 0.3 while fresh ≈ 0.75.
    await service.seedMemoryForTests({
      roomId: "room-decay",
      playerId: "p1",
      npcId: "npc-1",
      text: "stale-high",
      importance: 10,
      embedding: emb,
      createdAt: new Date(now - 365 * 24 * 3600_000),
    });
    await service.seedMemoryForTests({
      roomId: "room-decay",
      playerId: "p1",
      npcId: "npc-1",
      text: "fresh-mid",
      importance: 5,
      embedding: emb,
      createdAt: new Date(now - 1 * 3600_000),
    });

    const ctx = await service.buildMemoryContext("room-decay", "query", "npc-1", "p1");
    expect(ctx.retrieved[0]?.text).toBe("fresh-mid");
  });
});
