import { describe, expect, it } from "vitest";
import {
  COLYSEUS_SERVER_MESSAGES,
  type ColyseusCouncilDeliberationSyncPayload,
} from "./colyseus.js";
import {
  councilDeliberationFeedRowSchema,
  councilDeliberationPhaseSchema,
  councilDeliberationSyncPayloadSchema,
  linkedEdgeSchema,
  parseCouncilDeliberationFeedRow,
  parseCouncilDeliberationSyncPayload,
} from "./councilDeliberation.js";
import { normalizeEdgeIds } from "./councilRelationships.js";

describe("councilDeliberationPhaseSchema", () => {
  it("accepts proposal, debate, vote, sealed", () => {
    for (const phase of ["proposal", "debate", "vote", "sealed"] as const) {
      expect(councilDeliberationPhaseSchema.parse(phase)).toBe(phase);
    }
    expect(councilDeliberationPhaseSchema.safeParse("pending").success).toBe(false);
  });
});

describe("councilDeliberationFeedRowSchema", () => {
  it("discriminates quote rows with displayName and text max 80 chars", () => {
    const row = councilDeliberationFeedRowSchema.parse({
      kind: "quote",
      npcId: "npc-1",
      displayName: "莫玄虚",
      text: "秩序不可动摇。",
      travelerRef: true,
    });
    expect(row.kind).toBe("quote");
    expect(
      councilDeliberationFeedRowSchema.safeParse({
        kind: "quote",
        npcId: "npc-1",
        displayName: "莫玄虚",
        text: "x".repeat(81),
      }).success,
    ).toBe(false);
  });

  it("discriminates vote rows with yes|no", () => {
    const row = councilDeliberationFeedRowSchema.parse({
      kind: "vote",
      npcId: "npc-7",
      displayName: "苏清漪",
      vote: "yes",
      reasonZh: "赞成扩建农田。",
    });
    expect(row.kind).toBe("vote");
    expect(
      councilDeliberationFeedRowSchema.safeParse({
        kind: "vote",
        npcId: "npc-7",
        displayName: "苏清漪",
        vote: "abstain",
      }).success,
    ).toBe(false);
  });
});

describe("linkedEdgeSchema", () => {
  it("validates npcAId and npcBId strings", () => {
    expect(linkedEdgeSchema.parse({ npcAId: "npc-1", npcBId: "npc-2" })).toEqual({
      npcAId: "npc-1",
      npcBId: "npc-2",
    });
    expect(linkedEdgeSchema.safeParse({ npcAId: "", npcBId: "npc-2" }).success).toBe(false);
  });
});

describe("normalizeEdgeIds", () => {
  it("returns lexicographic min as npcAId and max as npcBId", () => {
    expect(normalizeEdgeIds("npc-12", "npc-1")).toEqual({
      npcAId: "npc-1",
      npcBId: "npc-12",
    });
    expect(normalizeEdgeIds("npc-3", "npc-7")).toEqual({
      npcAId: "npc-3",
      npcBId: "npc-7",
    });
  });
});

describe("councilDeliberationSyncPayloadSchema", () => {
  it("parses active deliberation sync with feedDelta", () => {
    const payload: ColyseusCouncilDeliberationSyncPayload = {
      active: true,
      voteKind: "regular",
      phase: "debate",
      round: 1,
      roundTotal: 2,
      proposalTitle: "扩建始源区农田",
      feedDelta: [
        {
          kind: "quote",
          npcId: "npc-1",
          displayName: "莫玄虚",
          text: "此举有违天道。",
        },
      ],
      linkedEdges: [{ npcAId: "npc-1", npcBId: "npc-2" }],
    };
    expect(councilDeliberationSyncPayloadSchema.parse(payload)).toEqual(payload);
    expect(parseCouncilDeliberationSyncPayload(payload)).toEqual(payload);
  });

  it("parses epoch vote phase with vote feed rows", () => {
    const payload = {
      active: true,
      voteKind: "epoch" as const,
      phase: "vote" as const,
      round: 3,
      roundTotal: 3,
      feedDelta: [
        {
          kind: "vote" as const,
          npcId: "npc-4",
          displayName: "莉莉丝",
          vote: "no" as const,
        },
      ],
    };
    expect(councilDeliberationSyncPayloadSchema.parse(payload)).toMatchObject(payload);
  });

  it("parses sealed result with clearFeed", () => {
    const payload = {
      active: false,
      voteKind: "regular" as const,
      phase: "sealed" as const,
      round: 2,
      roundTotal: 2,
      clearFeed: true,
      resultEntryId: "entry-1",
      yesCount: 7,
      noCount: 4,
      status: "accepted" as const,
    };
    expect(councilDeliberationSyncPayloadSchema.parse(payload)).toMatchObject(payload);
  });

  it("rejects yesCount above eleven council seats", () => {
    expect(
      councilDeliberationSyncPayloadSchema.safeParse({
        active: false,
        voteKind: "regular",
        phase: "sealed",
        round: 2,
        roundTotal: 2,
        yesCount: 12,
        noCount: 0,
      }).success,
    ).toBe(false);
  });
});

describe("parseCouncilDeliberationFeedRow", () => {
  it("delegates to feed row schema", () => {
    const row = parseCouncilDeliberationFeedRow({
      kind: "quote",
      npcId: "npc-11",
      displayName: "席十一",
      text: "细节必须完美。",
    });
    expect(row.kind).toBe("quote");
  });
});

describe("COLYSEUS_SERVER_MESSAGES", () => {
  it("includes councilDeliberationSync", () => {
    expect(COLYSEUS_SERVER_MESSAGES.councilDeliberationSync).toBe("councilDeliberationSync");
  });
});
