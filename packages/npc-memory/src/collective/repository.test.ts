import { describe, expect, it } from "vitest";
import {
  COLLECTIVE_EVENT_TTL_MS,
  DEFAULT_COLLECTIVE_WINDOW_MS,
  personalitySeedForNpc,
} from "@aetherlife/shared";
import { CollectiveRepository } from "./repository.js";

describe("CollectiveRepository (in-memory)", () => {
  it("inserts events and lists within window", async () => {
    const repo = new CollectiveRepository(null);
    const now = new Date();
    await repo.insertEvent({
      roomId: "r1",
      npcId: "npc-1",
      kind: "rude",
      summary: "玩家A出言不逊",
      playerIds: ["p-a", "p-b"],
      deltaScore: -8,
      createdAt: now,
    });

    const events = await repo.listEventsInWindow("r1", "npc-1", DEFAULT_COLLECTIVE_WINDOW_MS, now);
    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe("rude");
  });

  it("excludes events outside TTL", async () => {
    const repo = new CollectiveRepository(null);
    const old = new Date(Date.now() - COLLECTIVE_EVENT_TTL_MS - 1000);
    await repo.insertEvent({
      roomId: "r1",
      npcId: "npc-1",
      kind: "help",
      summary: "old",
      playerIds: ["p-a", "p-b"],
      deltaScore: 6,
      createdAt: old,
    });
    const events = await repo.listEventsInWindow("r1", "npc-1", DEFAULT_COLLECTIVE_WINDOW_MS);
    expect(events).toHaveLength(0);
  });

  it("counts distinct players in window", async () => {
    const repo = new CollectiveRepository(null);
    const now = new Date();
    await repo.insertEvent({
      roomId: "r2",
      npcId: "npc-1",
      kind: "help",
      summary: "协作",
      playerIds: ["p-a"],
      deltaScore: 6,
      createdAt: now,
    });
    const count = await repo.countDistinctPlayersInWindow("r2", "npc-1", DEFAULT_COLLECTIVE_WINDOW_MS, [
      "p-b",
    ]);
    expect(count).toBe(2);
  });

  it("applies personality seed on first attitude upsert", async () => {
    const repo = new CollectiveRepository(null);
    const delta = -8;
    const rep = await repo.applyReputationDelta("r1", "npc-1", "p-a", delta);
    expect(rep).toBe(personalitySeedForNpc("npc-1") + delta);
  });

  it("deleteForPlayer clears attitudes but keeps room events", async () => {
    const repo = new CollectiveRepository(null);
    await repo.insertEvent({
      roomId: "r3",
      npcId: "npc-1",
      kind: "rude",
      summary: "x",
      playerIds: ["p-a", "p-b"],
      deltaScore: -8,
    });
    await repo.applyReputationDelta("r3", "npc-1", "p-a", 1);
    await repo.applyReputationDelta("r3", "npc-1", "p-b", 2);
    await repo.deleteForPlayer("r3", "p-a");
    expect(await repo.getAttitude("r3", "npc-1", "p-a")).toBeNull();
    expect(await repo.getAttitude("r3", "npc-1", "p-b")).not.toBeNull();
    expect(await repo.listEventsInWindow("r3", "npc-1", DEFAULT_COLLECTIVE_WINDOW_MS)).toHaveLength(1);
  });

  it("deleteForRoom clears events and attitudes", async () => {
    const repo = new CollectiveRepository(null);
    await repo.insertEvent({
      roomId: "r3",
      npcId: "npc-1",
      kind: "rude",
      summary: "x",
      playerIds: ["p-a", "p-b"],
      deltaScore: -8,
    });
    await repo.applyReputationDelta("r3", "npc-1", "p-a", 1);
    await repo.deleteForRoom("r3");
    expect(await repo.getAttitude("r3", "npc-1", "p-a")).toBeNull();
    expect(await repo.listEventsInWindow("r3", "npc-1", DEFAULT_COLLECTIVE_WINDOW_MS)).toHaveLength(0);
  });
});
