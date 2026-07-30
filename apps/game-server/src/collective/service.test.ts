import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { CollectiveRepository } from "@aetherlife/npc-memory";
import {
  KIND_FIXED_DELTA,
  PROPAGATION_MAX_FANOUT,
  personalitySeedForNpc,
  type RelationshipEdgePublic,
} from "@aetherlife/shared";
import { CollectiveService } from "./service.js";
import * as npcRelationships from "../world/npc-relationships-repository.js";

function propEdge(
  partial: Pick<RelationshipEdgePublic, "npcAId" | "npcBId" | "baseTag" | "affection">,
): RelationshipEdgePublic {
  return {
    trust: 50,
    interactionCount: 0,
    lastInteractAt: null,
    currentStatus: [],
    historySummary: "",
    updatedAt: new Date().toISOString(),
    ...partial,
  };
}

describe("CollectiveService", () => {
  beforeEach(() => {
    CollectiveService.resetForTests(new CollectiveRepository(null));
    // Avoid real Postgres when DATABASE_URL is set (propagation list can hang / flake).
    vi.spyOn(npcRelationships, "listRelationshipsForRoom").mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
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

  it("propagation applies friend reputation without extra collective events", async () => {
    const listSpy = vi.spyOn(npcRelationships, "listRelationshipsForRoom").mockResolvedValue([
      propEdge({
        npcAId: "npc-1",
        npcBId: "npc-friend",
        baseTag: "ally",
        affection: 50,
      }),
    ]);

    const svc = CollectiveService.getInstance();
    const repo = svc.repoRef();
    const result = await svc.recordRuleEvent({
      roomId: "prop-room",
      npcId: "npc-1",
      kind: "rude",
      summary: "玩家粗鲁",
      playerIds: ["p-a"],
      npcPositions: new Map([["npc-1", { x: 0, y: 0 }]]),
      singlePlayerOk: true,
    });

    expect(listSpy).toHaveBeenCalledWith(
      "prop-room",
      expect.objectContaining({
        npcId: "npc-1",
        limit: PROPAGATION_MAX_FANOUT * 5,
      }),
    );
    expect(result).toEqual(expect.objectContaining({ recorded: true }));
    const events = await repo.listEventsInWindow("prop-room", "npc-1", 300_000);
    expect(events).toHaveLength(1);

    const friendRep = await repo.getAttitude("prop-room", "npc-friend", "p-a");
    expect(friendRep).toBe(personalitySeedForNpc("npc-friend") + Math.round(-8 * 0.3));
  });

  it("recordWorkerEvent propagation keeps event count === 1", async () => {
    vi.spyOn(npcRelationships, "listRelationshipsForRoom").mockResolvedValue([
      propEdge({
        npcAId: "npc-1",
        npcBId: "npc-friend",
        baseTag: "ally",
        affection: 50,
      }),
    ]);

    const svc = CollectiveService.getInstance();
    const repo = svc.repoRef();
    await svc.recordWorkerEvent({
      roomId: "prop-worker",
      npcId: "npc-1",
      kind: "rude",
      summary: "worker rude",
      playerIds: ["p-a"],
      deltaScore: -8,
      npcPositions: new Map([["npc-1", { x: 0, y: 0 }]]),
    });

    const events = await repo.listEventsInWindow("prop-worker", "npc-1", 300_000);
    expect(events).toHaveLength(1);
    const friendRep = await repo.getAttitude("prop-worker", "npc-friend", "p-a");
    expect(friendRep).toBe(personalitySeedForNpc("npc-friend") - 2);
  });

  it("relationship list failure does not throw out of recordRuleEvent", async () => {
    vi.spyOn(npcRelationships, "listRelationshipsForRoom").mockRejectedValueOnce(
      new Error("db unavailable"),
    );

    const svc = CollectiveService.getInstance();
    const repo = svc.repoRef();
    const result = await svc.recordRuleEvent({
      roomId: "prop-fail",
      npcId: "npc-1",
      kind: "help",
      summary: "help",
      playerIds: ["p-a", "p-b"],
      npcPositions: new Map([["npc-1", { x: 0, y: 0 }]]),
    });

    expect(result).toEqual(expect.objectContaining({ recorded: true }));
    const rep = await repo.getAttitude("prop-fail", "npc-1", "p-a");
    expect(rep).toBe(personalitySeedForNpc("npc-1") + KIND_FIXED_DELTA.help);
  });

  it("getCollectiveContext carries semantic from attitude row (D-BELIEF-05)", async () => {
    const svc = CollectiveService.getInstance();
    const repo = svc.repoRef();
    await repo.upsertSemanticState("r-sem-ctx", "npc-1", "p-a", {
      mood: "恼火",
      beliefs: ["我不信他的承诺"],
      summary: "玩家曾失信",
    });

    const ctx = await svc.getCollectiveContext("r-sem-ctx", "npc-1", "p-a");
    expect(ctx.currentMood).toBe("恼火");
    expect(ctx.keyBeliefs).toEqual(["我不信他的承诺"]);
    expect(ctx.summary).toBe("玩家曾失信");
    expect(ctx.band).toBeTruthy();
    expect(ctx.allowedTools.length).toBeGreaterThan(0);
    expect(typeof ctx.playerReputation).toBe("number");
  });

  it("getCollectiveContext omits semantic when no attitude row", async () => {
    const svc = CollectiveService.getInstance();
    const ctx = await svc.getCollectiveContext("r-no-att", "npc-1", "p-missing");
    expect(ctx.currentMood).toBeNull();
    expect(ctx.keyBeliefs).toBeNull();
    expect(ctx.summary).toBeNull();
    expect(ctx.playerReputation).toBe(personalitySeedForNpc("npc-1"));
  });

  it("getCollectiveState public payload strips mood/beliefs/summary (D-BELIEF-11)", async () => {
    const svc = CollectiveService.getInstance();
    const repo = svc.repoRef();
    await repo.upsertSemanticState("default", "npc-1", "p-pub", {
      mood: "戏谑",
      beliefs: ["他爱开玩笑"],
      summary: "内部摘要勿泄露",
    });

    const ctx = await svc.getCollectiveContext("default", "npc-1", "p-pub");
    expect(ctx.currentMood).toBe("戏谑");

    const publicPayload = await svc.getCollectiveState("default", "p-pub", "npc-1");
    const row = publicPayload.attitudes.find((a) => a.npcId === "npc-1");
    expect(row).toBeDefined();
    expect(row).not.toHaveProperty("currentMood");
    expect(row).not.toHaveProperty("keyBeliefs");
    expect(row).not.toHaveProperty("summary");
    expect(row).not.toHaveProperty("mood");
    expect(row).not.toHaveProperty("beliefs");
    expect(JSON.stringify(publicPayload)).not.toContain("戏谑");
    expect(JSON.stringify(publicPayload)).not.toContain("内部摘要勿泄露");
  });
});
