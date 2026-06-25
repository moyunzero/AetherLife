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
});
