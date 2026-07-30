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

  it("upsertSemanticState replaces beliefs and returns mood/beliefs/summary via getAttitudeRow", async () => {
    const repo = new CollectiveRepository(null);
    await repo.applyReputationDelta("r-sem", "npc-1", "p-a", 0);
    await repo.upsertSemanticState("r-sem", "npc-1", "p-a", {
      mood: "恼火",
      beliefs: ["我不信他的承诺"],
      summary: "他反复失信",
    });

    const row = await repo.getAttitudeRow("r-sem", "npc-1", "p-a");
    expect(row).not.toBeNull();
    expect(row!.currentMood).toBe("恼火");
    expect(row!.keyBeliefs).toEqual(["我不信他的承诺"]);
    expect(row!.summary).toBe("他反复失信");
    expect(row!.reputation).toBe(personalitySeedForNpc("npc-1"));

    await repo.upsertSemanticState("r-sem", "npc-1", "p-a", {
      beliefs: ["我决定再观察一次"],
    });
    const afterReplace = await repo.getAttitudeRow("r-sem", "npc-1", "p-a");
    expect(afterReplace!.keyBeliefs).toEqual(["我决定再观察一次"]);
    expect(afterReplace!.currentMood).toBe("恼火");
    expect(afterReplace!.summary).toBe("他反复失信");
  });

  it("omit path leaves prior semantic columns unchanged (D-BELIEF-07)", async () => {
    const repo = new CollectiveRepository(null);
    await repo.upsertSemanticState("r-omit", "npc-2", "p-a", {
      mood: "愉悦",
      beliefs: ["我信任他"],
      summary: "进展顺利",
    });
    await repo.upsertSemanticState("r-omit", "npc-2", "p-a", {});
    const row = await repo.getAttitudeRow("r-omit", "npc-2", "p-a");
    expect(row!.currentMood).toBe("愉悦");
    expect(row!.keyBeliefs).toEqual(["我信任他"]);
    expect(row!.summary).toBe("进展顺利");
  });

  it("applyReputationDelta does not wipe mood/beliefs/summary (Pitfall 3)", async () => {
    const repo = new CollectiveRepository(null);
    await repo.upsertSemanticState("r-rep", "npc-1", "p-a", {
      mood: "警惕",
      beliefs: ["他可能在试探我"],
      summary: "保持距离",
    });
    const before = await repo.getAttitudeRow("r-rep", "npc-1", "p-a");
    await repo.applyReputationDelta("r-rep", "npc-1", "p-a", -8);
    const after = await repo.getAttitudeRow("r-rep", "npc-1", "p-a");
    expect(after!.currentMood).toBe("警惕");
    expect(after!.keyBeliefs).toEqual(["他可能在试探我"]);
    expect(after!.summary).toBe("保持距离");
    expect(after!.reputation).toBe((before!.reputation) - 8);
  });
});
