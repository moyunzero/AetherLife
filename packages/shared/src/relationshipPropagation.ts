import type { WitnessDeltaUpdate } from "./collectiveMemory.js";

/** D-PROP-10: fraction of event delta applied to related NPCs (same order as witness). */
export const PROPAGATION_FRACTION = 0.3;
/** D-PROP-10: minimum |affection| for an edge to propagate. */
export const PROPAGATION_MIN_AFFECTION = 30;
/** D-PROP-10: max related NPCs updated per event. */
export const PROPAGATION_MAX_FANOUT = 3;
/** D-PROP-10: skip propagation when |eventDelta| is below this. */
export const PROPAGATION_MIN_EVENT = 5;
/** D-PROP-10: clamp |propagated delta| to this. */
export const PROPAGATION_MAX_ABS = 5;

/** Minimal edge fields needed for propagation. */
export type PropagationEdge = {
  npcAId: string;
  npcBId: string;
  baseTag: string;
  affection: number;
};
const FRIEND_BASE_TAGS = new Set([
  "friend",
  "ally",
  "close_ally",
  "strategic_ally",
  "chaos_ally",
  "chaotic_ally",
  "chaos_buddy",
  "support",
  "cooperate",
  "partner",
]);

const RIVAL_ENEMY_BASE_TAGS = new Set(["rival", "nemesis", "enemy", "foe"]);

/**
 * +1 = friend (same sign), -1 = rival/enemy (invert), 0 = skip.
 */
export function propagationPolarityForBaseTag(baseTag: string): 1 | -1 | 0 {
  const k = baseTag.toLowerCase();
  if (FRIEND_BASE_TAGS.has(k)) return 1;
  if (RIVAL_ENEMY_BASE_TAGS.has(k)) return -1;
  return 0;
}

function clampPropagationDelta(delta: number): number {
  if (delta === 0) return 0;
  const sign = delta < 0 ? -1 : 1;
  return sign * Math.min(PROPAGATION_MAX_ABS, Math.abs(delta));
}

export type ComputeRelationshipPropagationInput = {
  targetNpcId: string;
  eventDelta: number;
  playerIds: readonly string[];
  edges: readonly PropagationEdge[];
  /** NPC ids already updated by witness (includes target). */
  alreadyUpdated: ReadonlySet<string>;
};

/**
 * 2-hop reputation deltas from relationship edges (D-PROP-01…10).
 * Pure — no I/O; never emits collective events.
 * Returns WitnessDeltaUpdate[] for reuse with applyReputationDelta.
 */
export function computeRelationshipPropagationDeltas(
  input: ComputeRelationshipPropagationInput,
): WitnessDeltaUpdate[] {
  if (Math.abs(input.eventDelta) < PROPAGATION_MIN_EVENT) return [];

  const raw = Math.round(input.eventDelta * PROPAGATION_FRACTION);
  const baseDelta = clampPropagationDelta(raw);
  if (baseDelta === 0) return [];

  type Candidate = { npcId: string; polarity: 1 | -1; absAffection: number };
  const candidates: Candidate[] = [];

  for (const edge of input.edges) {
    const other =
      edge.npcAId === input.targetNpcId
        ? edge.npcBId
        : edge.npcBId === input.targetNpcId
          ? edge.npcAId
          : null;
    if (!other || other === input.targetNpcId) continue;
    if (input.alreadyUpdated.has(other)) continue;
    if (Math.abs(edge.affection) < PROPAGATION_MIN_AFFECTION) continue;

    const polarity = propagationPolarityForBaseTag(edge.baseTag);
    if (polarity === 0) continue;

    candidates.push({
      npcId: other,
      polarity,
      absAffection: Math.abs(edge.affection),
    });
  }

  candidates.sort((a, b) => b.absAffection - a.absAffection);
  const selected = candidates.slice(0, PROPAGATION_MAX_FANOUT);

  const updates: WitnessDeltaUpdate[] = [];
  for (const c of selected) {
    const delta = clampPropagationDelta(baseDelta * c.polarity);
    if (delta === 0) continue;
    for (const playerId of input.playerIds) {
      updates.push({ npcId: c.npcId, playerId, delta });
    }
  }
  return updates;
}
