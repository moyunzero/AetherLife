import { beforeEach, describe, expect, it } from "vitest";
import { COUNCIL_MEMORY_PLAYER_ID } from "@aetherlife/shared";
import { CollectiveRepository } from "@aetherlife/npc-memory";
import { CollectiveService } from "../collective/service.js";
import { MemoryService } from "./service.js";

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
});
