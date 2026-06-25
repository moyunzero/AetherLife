import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  COUNCIL_MEMORY_PLAYER_ID,
  COUNCIL_NPC_IDS,
  getPersona,
} from "@aetherlife/shared";
import { CollectiveRepository } from "@aetherlife/npc-memory";
import { CollectiveService } from "../collective/service.js";
import { MemoryService } from "./service.js";
import { seedCouncilMemoriesIfNeeded } from "./councilSeed.js";

describe("seedCouncilMemoriesIfNeeded", () => {
  beforeEach(() => {
    delete process.env.DATABASE_URL;
    MemoryService.resetForTests();
    CollectiveService.resetForTests(new CollectiveRepository(null));
  });

  it("seeds stanceManifestoShort and ltmSeeds for each council npc", async () => {
    const service = MemoryService.getInstance();
    await seedCouncilMemoriesIfNeeded("room-seed");

    for (const npcId of COUNCIL_NPC_IDS) {
      const persona = getPersona(npcId);
      const expectedCount =
        (persona.stanceManifestoShort ? 1 : 0) + (persona.ltmSeeds?.length ?? 0);
      const count = await service.getMemoryCount("room-seed", npcId, COUNCIL_MEMORY_PLAYER_ID);
      expect(count).toBe(expectedCount);
    }
  });

  it("skips npc when __council__ memories already exist", async () => {
    const service = MemoryService.getInstance();
    await service.appendNpcMemory(
      "room-partial",
      "existing seed",
      "npc-1",
      COUNCIL_MEMORY_PLAYER_ID,
      9,
    );

    const appendSpy = vi.spyOn(service, "appendNpcMemory");
    await seedCouncilMemoriesIfNeeded("room-partial");

    const npc1Calls = appendSpy.mock.calls.filter(([, , npcId]) => npcId === "npc-1");
    expect(npc1Calls).toHaveLength(0);
    expect(appendSpy.mock.calls.length).toBeGreaterThan(0);
    appendSpy.mockRestore();
  });

  it("second call does not duplicate rows", async () => {
    const service = MemoryService.getInstance();
    await seedCouncilMemoriesIfNeeded("room-idempotent");
    const countsAfterFirst = await Promise.all(
      COUNCIL_NPC_IDS.map((npcId) =>
        service.getMemoryCount("room-idempotent", npcId, COUNCIL_MEMORY_PLAYER_ID),
      ),
    );

    await seedCouncilMemoriesIfNeeded("room-idempotent");

    const countsAfterSecond = await Promise.all(
      COUNCIL_NPC_IDS.map((npcId) =>
        service.getMemoryCount("room-idempotent", npcId, COUNCIL_MEMORY_PLAYER_ID),
      ),
    );
    expect(countsAfterSecond).toEqual(countsAfterFirst);
  });
});
