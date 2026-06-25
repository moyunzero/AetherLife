import { describe, expect, it, beforeEach } from "vitest";
import { CollectiveRepository } from "@aetherlife/npc-memory";
import { KIND_FIXED_DELTA, personalitySeedForNpc } from "@aetherlife/shared";
import { CollectiveService } from "./service.js";

describe("CollectiveService", () => {
  beforeEach(() => {
    CollectiveService.resetForTests(new CollectiveRepository(null));
  });

  it("records event when two players in window", async () => {
    const svc = CollectiveService.getInstance();
    const repo = svc.repoRef();
    const now = new Date();
    await repo.insertEvent({
      roomId: "r1",
      npcId: "npc-1",
      kind: "help",
      summary: "prior",
      playerIds: ["p-a"],
      deltaScore: 6,
      createdAt: now,
    });

    const positions = new Map([["npc-1", { x: 2, y: 2 }]]);
    const result = await svc.recordRuleEvent({
      roomId: "r1",
      npcId: "npc-1",
      kind: "rude",
      summary: "玩家B粗鲁",
      playerIds: ["p-b"],
      npcPositions: positions,
    });

    expect(result).toEqual(expect.objectContaining({ recorded: true }));
    const rep = await repo.getAttitude("r1", "npc-1", "p-b");
    expect(rep).toBeLessThan(0);
  });

  it("skips single-player action window", async () => {
    const svc = CollectiveService.getInstance();
    const result = await svc.recordRuleEvent({
      roomId: "solo",
      npcId: "npc-1",
      kind: "compete_object",
      summary: "alone",
      playerIds: ["p-a"],
      npcPositions: new Map([["npc-1", { x: 0, y: 0 }]]),
    });
    expect(result).toEqual({ recorded: false, reason: "single_player" });
  });

  it("records speak rude for solo player when singlePlayerOk", async () => {
    const svc = CollectiveService.getInstance();
    const repo = svc.repoRef();
    const result = await svc.recordRuleEvent({
      roomId: "solo",
      npcId: "npc-2",
      kind: "rude",
      summary: "玩家言语粗鲁",
      playerIds: ["p-a"],
      npcPositions: new Map([
        ["npc-1", { x: 2, y: 2 }],
        ["npc-2", { x: 4, y: 2 }],
      ]),
      singlePlayerOk: true,
    });
    expect(result).toEqual(expect.objectContaining({ recorded: true }));
    const rep = await repo.getAttitude("solo", "npc-2", "p-a");
    expect(rep).toBe(personalitySeedForNpc("npc-2") + KIND_FIXED_DELTA.rude);
  });

  it("recordWorkerEvent writes worker speak social for solo player", async () => {
    const svc = CollectiveService.getInstance();
    const repo = svc.repoRef();
    const { eventId } = await svc.recordWorkerEvent({
      roomId: "solo-worker",
      npcId: "npc-1",
      kind: "rude",
      summary: "玩家言语不敬",
      playerIds: ["p-a"],
      deltaScore: -8,
      npcPositions: new Map([["npc-1", { x: 2, y: 2 }]]),
    });
    expect(eventId).toBeTruthy();
    const rep = await repo.getAttitude("solo-worker", "npc-1", "p-a");
    expect(rep).toBe(personalitySeedForNpc("npc-1") + (-8));
  });
});
