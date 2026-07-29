import { z } from "zod";
import { bandFromEffectiveScore, type AttitudeBand } from "./attitude.js";
import { relationshipKindLabelZh } from "./council/relationshipLabels.js";
import type { CouncilArchetype } from "./council/types.js";
import { COUNCIL_NPC_IDS, type CouncilNpcId } from "./council/constants.js";

/** Per-archetype relationship delta multiplier (RELATIONSHIP-DYNAMICS.md). */
export const ARCHETYPE_CHANGE_RATE: Record<CouncilArchetype, number> = {
  order_keeper: 0.3,
  expansionist: 1.0,
  logician: 0.8,
  chaos_agent: 1.5,
  pacifist: 0.9,
  power_broker: 1.1,
  mediator: 1.2,
  guardian: 0.85,
  aesthete: 0.95,
  brawler: 1.3,
  perfectionist: 0.75,
  explorer: 1.0,
};

/** Maximum absolute affection change per delta application. */
export const RELATIONSHIP_DELTA_ABS_MAX = 15;

export const RELATIONSHIP_AFFECTION_MIN = -100;
export const RELATIONSHIP_AFFECTION_MAX = 100;

export const linkedEdgeSchema = z
  .object({
    npcAId: z.string().min(1),
    npcBId: z.string().min(1),
  })
  .strict();

export type LinkedEdge = z.infer<typeof linkedEdgeSchema>;

export type RelationshipEdgePublic = {
  npcAId: string;
  npcBId: string;
  baseTag: string;
  affection: number;
  trust: number;
  interactionCount: number;
  lastInteractAt: string | null;
  currentStatus: string[];
  historySummary: string;
  updatedAt: string;
};

/**
 * Player-facing affection bands for 关系网 (D-GRAPH-02 / UI-SPEC).
 * Same numeric cutoffs as {@link bandFromEffectiveScore}; ids differ from
 * collective AttitudeBand (`wary`→`cool`, `allied`→`close`).
 */
export type RelationshipBand = "hostile" | "cool" | "neutral" | "warm" | "close";

const ATTITUDE_TO_RELATIONSHIP_BAND: Record<AttitudeBand, RelationshipBand> = {
  hostile: "hostile",
  wary: "cool",
  neutral: "neutral",
  warm: "warm",
  allied: "close",
};

/** Map affection score → relationship band (reuses attitude numeric thresholds). */
export function relationshipBandFromAffection(affection: number): RelationshipBand {
  return ATTITUDE_TO_RELATIONSHIP_BAND[bandFromEffectiveScore(affection)];
}

/** UI-SPEC ZH labels for 关系网 — never collective 戒备/同盟. */
export function relationshipBandLabelZh(band: RelationshipBand): string {
  switch (band) {
    case "hostile":
      return "敌对";
    case "cool":
      return "冷淡";
    case "neutral":
      return "平常";
    case "warm":
      return "亲近";
    case "close":
      return "亲密";
  }
}

/**
 * Player GET DTO — band-mapped only; never includes affection/trust integers (D-GRAPH-02).
 * Worker/internal still use {@link RelationshipEdgePublic}.
 */
export type RelationshipEdgeBandPublic = {
  npcAId: string;
  npcBId: string;
  baseTag: string;
  band: RelationshipBand;
  bandLabelZh: string;
  kindLabelZh: string;
  currentStatus: string[];
};

export const relationshipEdgeBandPublicSchema = z
  .object({
    npcAId: z.string().min(1),
    npcBId: z.string().min(1),
    baseTag: z.string(),
    band: z.enum(["hostile", "cool", "neutral", "warm", "close"]),
    bandLabelZh: z.string().min(1),
    kindLabelZh: z.string().min(1),
    currentStatus: z.array(z.string()),
  })
  .strict();

export function toRelationshipEdgeBandPublic(
  edge: RelationshipEdgePublic,
): RelationshipEdgeBandPublic {
  const band = relationshipBandFromAffection(edge.affection);
  return {
    npcAId: edge.npcAId,
    npcBId: edge.npcBId,
    baseTag: edge.baseTag,
    band,
    bandLabelZh: relationshipBandLabelZh(band),
    kindLabelZh: relationshipKindLabelZh(edge.baseTag),
    currentStatus: edge.currentStatus,
  };
}

export const relationshipDeltaInputSchema = z
  .object({
    npcAId: z.string().min(1),
    npcBId: z.string().min(1),
    affectionDelta: z.number().int(),
    trustDelta: z.number().int().optional(),
    historyAppend: z.string().max(200).optional(),
    statusTags: z.array(z.string().min(1)).optional(),
  })
  .strict();

export type RelationshipDeltaInput = z.infer<typeof relationshipDeltaInputSchema>;

export function normalizeEdgeIds(
  npcAId: string,
  npcBId: string,
): { npcAId: string; npcBId: string } {
  if (npcAId === npcBId) {
    throw new Error("normalizeEdgeIds: npc ids must differ");
  }
  return npcAId < npcBId
    ? { npcAId, npcBId }
    : { npcAId: npcBId, npcBId: npcAId };
}

/**
 * Order pair by COUNCIL_NPC_IDS seat index (npc-1…npc-12).
 * Use for registry SSOT lookup; DB storage still uses {@link normalizeEdgeIds} string order.
 */
export function councilIndexEdgeIds(
  npcAId: string,
  npcBId: string,
): { npcAId: string; npcBId: string } {
  if (npcAId === npcBId) {
    throw new Error("councilIndexEdgeIds: npc ids must differ");
  }
  const idxA = (COUNCIL_NPC_IDS as readonly string[]).indexOf(npcAId);
  const idxB = (COUNCIL_NPC_IDS as readonly string[]).indexOf(npcBId);
  if (idxA === -1 || idxB === -1) {
    return normalizeEdgeIds(npcAId, npcBId);
  }
  return idxA < idxB
    ? { npcAId: npcAId as CouncilNpcId, npcBId: npcBId as CouncilNpcId }
    : { npcAId: npcBId as CouncilNpcId, npcBId: npcAId as CouncilNpcId };
}

export function clampAffection(value: number): number {
  return Math.min(RELATIONSHIP_AFFECTION_MAX, Math.max(RELATIONSHIP_AFFECTION_MIN, value));
}

export function clampTrust(value: number): number {
  return Math.min(100, Math.max(0, value));
}

export function clampDeltaMagnitude(delta: number): number {
  const sign = delta < 0 ? -1 : delta > 0 ? 1 : 0;
  return sign * Math.min(RELATIONSHIP_DELTA_ABS_MAX, Math.abs(delta));
}

/**
 * Maps registry relationship `kind` to initial seed affection (RELATIONSHIP-DYNAMICS §初始映射).
 */
export function initialAffectionFromKind(kind: string): number {
  const k = kind.toLowerCase();
  if (k === "nemesis" || k === "rival") return -50;
  if (
    k === "ally" ||
    k === "close_ally" ||
    k === "strategic_ally" ||
    k === "chaos_ally" ||
    k === "chaotic_ally" ||
    k === "chaos_buddy"
  ) {
    return 50;
  }
  if (k.startsWith("respect") || k === "peer" || k === "appreciate" || k === "grateful") {
    return 22;
  }
  if (
    k.startsWith("wary") ||
    k.startsWith("cautious") ||
    k === "suspicious" ||
    k === "avoid" ||
    k === "watch" ||
    k === "distant"
  ) {
    return -7;
  }
  if (
    k === "deal" ||
    k === "chess" ||
    k === "frenemy" ||
    k === "mixed" ||
    k === "trade" ||
    k === "opportunistic"
  ) {
    return 2;
  }
  if (
    k === "disdain" ||
    k === "opposes" ||
    k === "clash" ||
    k === "friction" ||
    k === "conflict_caution" ||
    k === "conflict_respect"
  ) {
    return -30;
  }
  if (k === "gentle_conflict" || k === "gentle_oppose") return -10;
  if (k === "support" || k === "cooperate" || k === "partner") return 35;
  return 0;
}

/** Initial trust from affection seed: max(0, affection + 50) capped at 100. */
export function initialTrustFromAffection(affection: number): number {
  return clampTrust(Math.max(0, affection + 50));
}

export function changeRateForArchetype(archetype: CouncilArchetype): number {
  return ARCHETYPE_CHANGE_RATE[archetype];
}

export function parseRelationshipDeltaInput(input: unknown): RelationshipDeltaInput {
  return relationshipDeltaInputSchema.parse(input);
}

export function safeParseRelationshipDeltaInput(input: unknown) {
  return relationshipDeltaInputSchema.safeParse(input);
}
