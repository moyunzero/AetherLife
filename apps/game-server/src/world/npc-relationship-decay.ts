/**
 * Silent idle-edge affection decay (D-DECAY-01…04).
 *
 * Soft floor/ceiling (RELATIONSHIP-DYNAMICS seed bands): decay drifts toward 0
 * but stops at the band edge so base_tag identity is not erased by idle alone.
 * |Δ| per monthly pass is 1–3. Uses applyIdleDecayDeltas only (never the interact-bump path).
 */

import { MINUTES_PER_DAY, DAYS_PER_MONTH, clampAffection } from "@aetherlife/shared";
import {
  applyIdleDecayDeltas,
  listRelationshipsForRoom,
  getLastInteractAbsMinute,
  getSeedAbsMinute,
  type IdleDecayDelta,
} from "./npc-relationships-repository.js";

/** One game-month in absoluteGameMinute units (30 × 1440). */
export const GAME_MONTH_MINUTES = DAYS_PER_MONTH * MINUTES_PER_DAY;

/** Last monthIndex for which decay ran (per room). */
const lastDecayMonthByRoom = new Map<string, number>();

export type SoftBounds = { floor: number; ceiling: number };

/**
 * Soft bounds from RELATIONSHIP-DYNAMICS kind→seed bands.
 * Positive bands: floor = seed min. Negative bands: ceiling = seed max (least cold).
 */
export function softBoundsForBaseTag(baseTag: string): SoftBounds {
  const k = baseTag.toLowerCase();
  if (k === "nemesis" || k === "rival") return { floor: -100, ceiling: -40 };
  if (
    k === "ally" ||
    k === "close_ally" ||
    k === "strategic_ally" ||
    k === "chaos_ally" ||
    k === "chaotic_ally" ||
    k === "chaos_buddy"
  ) {
    return { floor: 40, ceiling: 100 };
  }
  if (k.startsWith("respect") || k === "peer" || k === "appreciate" || k === "grateful") {
    return { floor: 15, ceiling: 100 };
  }
  if (
    k.startsWith("wary") ||
    k.startsWith("cautious") ||
    k === "suspicious" ||
    k === "avoid" ||
    k === "watch" ||
    k === "distant"
  ) {
    return { floor: -100, ceiling: 0 };
  }
  if (
    k === "deal" ||
    k === "chess" ||
    k === "frenemy" ||
    k === "mixed" ||
    k === "trade" ||
    k === "opportunistic"
  ) {
    return { floor: -5, ceiling: 10 };
  }
  if (
    k === "disdain" ||
    k === "opposes" ||
    k === "clash" ||
    k === "friction" ||
    k === "conflict_caution" ||
    k === "conflict_respect"
  ) {
    return { floor: -100, ceiling: -15 };
  }
  if (k === "gentle_conflict" || k === "gentle_oppose") return { floor: -100, ceiling: 0 };
  if (k === "support" || k === "cooperate" || k === "partner") return { floor: 35, ceiling: 100 };
  return { floor: -100, ceiling: 100 };
}

export function monthIndexFromAbsoluteMinute(absoluteGameMinute: number): number {
  return Math.floor(Math.max(0, absoluteGameMinute) / GAME_MONTH_MINUTES);
}

/** Test helper */
export function clearRelationshipDecayState(): void {
  lastDecayMonthByRoom.clear();
}

/**
 * Compute affection delta toward 0 for one idle monthly step.
 * Magnitude 1–3; clamped by soft bounds. rng() → [0,1) selects step size.
 */
export function computeIdleDecayDelta(
  affection: number,
  baseTag: string,
  rng: () => number = Math.random,
): number {
  if (affection === 0) return 0;
  const step = 1 + Math.floor(Math.min(0.999999, Math.max(0, rng())) * 3);
  const { floor, ceiling } = softBoundsForBaseTag(baseTag);

  if (affection > 0) {
    const candidate = affection - step;
    const next = Math.max(0, floor, candidate);
    return clampAffection(next) - affection;
  }

  // affection < 0 — drift toward 0
  const candidate = affection + step;
  let next = Math.min(0, candidate);
  if (affection <= ceiling) {
    next = Math.min(ceiling, next);
  }
  return clampAffection(next) - affection;
}

export function isIdleEdge(
  roomId: string,
  npcAId: string,
  npcBId: string,
  absoluteGameMinute: number,
): boolean {
  const last =
    getLastInteractAbsMinute(roomId, npcAId, npcBId) ??
    getSeedAbsMinute(roomId, npcAId, npcBId) ??
    0;
  return absoluteGameMinute - last >= GAME_MONTH_MINUTES;
}

export type MaybeRunRelationshipDecayOptions = {
  /** Ignored — D-DECAY-04: decay is not blocked by council in-flight. */
  councilInFlight?: boolean;
  rng?: () => number;
};

export type MaybeRunRelationshipDecayResult = {
  decayed: number;
  monthIndex: number;
  broadcast: false;
  biographyEnqueued: false;
  skippedForCouncil: false;
};

/**
 * On game-month rollover, apply silent idle decay for stale edges.
 * No LLM, no relationshipSync, no biography.
 */
export async function maybeRunRelationshipDecay(
  roomId: string,
  absoluteGameMinute: number,
  options?: MaybeRunRelationshipDecayOptions,
): Promise<MaybeRunRelationshipDecayResult> {
  void options?.councilInFlight; // D-DECAY-04: intentionally unused
  const monthIndex = monthIndexFromAbsoluteMinute(absoluteGameMinute);
  const empty: MaybeRunRelationshipDecayResult = {
    decayed: 0,
    monthIndex,
    broadcast: false,
    biographyEnqueued: false,
    skippedForCouncil: false,
  };
  if (monthIndex <= 0) return empty;

  const prev = lastDecayMonthByRoom.get(roomId);
  if (prev === monthIndex) return empty;
  lastDecayMonthByRoom.set(roomId, monthIndex);

  const edges = await listRelationshipsForRoom(roomId);
  const deltas: IdleDecayDelta[] = [];
  const rng = options?.rng ?? Math.random;

  for (const edge of edges) {
    if (!isIdleEdge(roomId, edge.npcAId, edge.npcBId, absoluteGameMinute)) continue;
    const affectionDelta = computeIdleDecayDelta(edge.affection, edge.baseTag, rng);
    if (affectionDelta === 0) continue;
    deltas.push({
      npcAId: edge.npcAId,
      npcBId: edge.npcBId,
      affectionDelta,
    });
  }

  if (deltas.length === 0) {
    return empty;
  }

  const { updated } = await applyIdleDecayDeltas({ roomId, deltas });
  return {
    decayed: updated,
    monthIndex,
    broadcast: false,
    biographyEnqueued: false,
    skippedForCouncil: false,
  };
}
