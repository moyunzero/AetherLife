import { describe, expect, it } from "vitest";
import { bandLabelZh } from "./attitude.js";
import {
  relationshipBandFromAffection,
  relationshipBandLabelZh,
  relationshipEdgeBandPublicSchema,
  toRelationshipEdgeBandPublic,
  type RelationshipBand,
  type RelationshipEdgePublic,
} from "./councilRelationships.js";

const ALL_BANDS: RelationshipBand[] = ["hostile", "cool", "neutral", "warm", "close"];

describe("relationshipBandFromAffection", () => {
  it("maps cutoff boundaries (same numeric cutoffs as bandFromEffectiveScore)", () => {
    expect(relationshipBandFromAffection(-31)).toBe("hostile");
    expect(relationshipBandFromAffection(-30)).toBe("cool");
    expect(relationshipBandFromAffection(-1)).toBe("cool");
    expect(relationshipBandFromAffection(0)).toBe("neutral");
    expect(relationshipBandFromAffection(19)).toBe("neutral");
    expect(relationshipBandFromAffection(20)).toBe("warm");
    expect(relationshipBandFromAffection(49)).toBe("warm");
    expect(relationshipBandFromAffection(50)).toBe("close");
  });
});

describe("relationshipBandLabelZh", () => {
  it("returns UI-SPEC 关系网 labels (not collective 戒备/同盟)", () => {
    expect(relationshipBandLabelZh("hostile")).toBe("敌对");
    expect(relationshipBandLabelZh("cool")).toBe("冷淡");
    expect(relationshipBandLabelZh("neutral")).toBe("平常");
    expect(relationshipBandLabelZh("warm")).toBe("亲近");
    expect(relationshipBandLabelZh("close")).toBe("亲密");
    for (const band of ALL_BANDS) {
      expect(relationshipBandLabelZh(band)).not.toBe(bandLabelZh("wary"));
      expect(relationshipBandLabelZh(band)).not.toBe(bandLabelZh("allied"));
    }
  });
});

describe("RelationshipEdgeBandPublic", () => {
  const internalEdge: RelationshipEdgePublic = {
    npcAId: "npc-1",
    npcBId: "npc-2",
    baseTag: "rival",
    affection: -40,
    trust: 10,
    interactionCount: 3,
    lastInteractAt: null,
    currentStatus: ["tense"],
    historySummary: "secret",
    updatedAt: "2026-07-21T00:00:00.000Z",
  };

  it("omits affection and trust integers from public DTO", () => {
    const pub = toRelationshipEdgeBandPublic(internalEdge);
    expect(pub).not.toHaveProperty("affection");
    expect(pub).not.toHaveProperty("trust");
    expect(pub.npcAId).toBe("npc-1");
    expect(pub.npcBId).toBe("npc-2");
    expect(pub.band).toBe("hostile");
    expect(pub.bandLabelZh).toBe("敌对");
    expect(pub.kindLabelZh).toBeTruthy();
    expect(pub.currentStatus).toEqual(["tense"]);
    const parsed = relationshipEdgeBandPublicSchema.parse(pub);
    expect("affection" in parsed).toBe(false);
    expect("trust" in parsed).toBe(false);
  });

  it("rejects payloads that include affection or trust", () => {
    const leak = {
      ...toRelationshipEdgeBandPublic(internalEdge),
      affection: -40,
      trust: 10,
    };
    expect(relationshipEdgeBandPublicSchema.safeParse(leak).success).toBe(false);
  });
});
