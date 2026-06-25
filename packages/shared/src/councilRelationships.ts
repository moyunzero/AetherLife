import { z } from "zod";
import type { CouncilArchetype } from "./council/types.js";

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
