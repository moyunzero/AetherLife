/**
 * NPC mutual-chat proximity selector + daily stagger (D-MUTUAL-01/03/05/07).
 * Enqueues only — no LLM in tick. Visible chat owned by mutual-chat budget.
 */

import {
  COUNCIL_NPC_IDS,
  MINUTES_PER_DAY,
  isCouncilNpcId,
  normalizeEdgeIds,
  stableStringHash,
} from "@aetherlife/shared";
import {
  resolveScheduleSegment,
  shouldSkipMovement,
} from "../ambient/schedule.js";
import { enqueueNpcMutualChatJob } from "../queue/npc-mutual-chat.js";
import { getRoomVoteState } from "./world-vote-state.js";

/** Max mutual-chat pair triggers per room per SSOT game day (target 2–3). */
export const MUTUAL_CHAT_MAX_PER_DAY = 3;
const MUTUAL_CHEBYSHEV_MAX = 2;
/** Default selection rate when not force-selecting (~12%). */
const MUTUAL_SELECT_PCT = 12;

export type MutualChatNpcPos = {
  id: string;
  x: number;
  y: number;
};

export type MutualChatCandidate = {
  npcAId: string;
  npcBId: string;
  weight: number;
};

const pairClaims = new Set<string>();
const countByRoomDay = new Map<string, number>();

function dayIndexFromAbsoluteMinute(absoluteGameMinute: number): number {
  return Math.floor(Math.max(0, absoluteGameMinute) / MINUTES_PER_DAY);
}

function pairClaimKey(roomId: string, dayIndex: number, a: string, b: string): string {
  const { npcAId, npcBId } = normalizeEdgeIds(a, b);
  return `${roomId}:${dayIndex}:${npcAId}:${npcBId}`;
}

function roomDayKey(roomId: string, dayIndex: number): string {
  return `${roomId}:${dayIndex}`;
}

function chebyshev(ax: number, ay: number, bx: number, by: number): number {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

function seatIndex(npcId: string): number {
  return (COUNCIL_NPC_IDS as readonly string[]).indexOf(npcId);
}

/**
 * 12-seat bucket rotation: pair is in today's focus when either seat's
 * index % 4 matches dayIndex % 4 (spreads pair opportunities across days).
 */
export function pairInDailyBucket(
  npcAId: string,
  npcBId: string,
  dayIndex: number,
): boolean {
  const bucket = ((dayIndex % 4) + 4) % 4;
  const ia = seatIndex(npcAId);
  const ib = seatIndex(npcBId);
  if (ia < 0 || ib < 0) return false;
  return ia % 4 === bucket || ib % 4 === bucket;
}

function scoreKey(a: string, b: string): string {
  const { npcAId, npcBId } = normalizeEdgeIds(a, b);
  return `${npcAId}:${npcBId}`;
}

function zoneInVillageBand(zoneId: string | undefined): boolean {
  if (!zoneId) return false;
  return /village|plaza|square|market|beginning-fields/i.test(zoneId);
}

/** Same defer rule as world-vote: any in-flight speak → skip enqueue. */
export function shouldDeferNpcMutualChatEnqueue(
  npcSpeakJobsSize: number,
): boolean {
  return npcSpeakJobsSize > 0;
}

export function clearNpcMutualChatState(): void {
  pairClaims.clear();
  countByRoomDay.clear();
}

export function isPairClaimedForMutualChat(
  roomId: string,
  dayIndex: number,
  a: string,
  b: string,
): boolean {
  return pairClaims.has(pairClaimKey(roomId, dayIndex, a, b));
}

function schedulesOverlapAndAvailable(
  npcAId: string,
  npcBId: string,
  gameMinuteOfDay: number,
  villageBandOnly: boolean,
): boolean {
  const segA = resolveScheduleSegment(npcAId, gameMinuteOfDay);
  const segB = resolveScheduleSegment(npcBId, gameMinuteOfDay);
  if (!segA || !segB) return false;
  if (shouldSkipMovement(segA) || shouldSkipMovement(segB)) return false;
  if (villageBandOnly) {
    if (!zoneInVillageBand(segA.zoneId) || !zoneInVillageBand(segB.zoneId)) {
      return false;
    }
  }
  return true;
}

/**
 * Select nearby council pairs and enqueue up to MUTUAL_CHAT_MAX_PER_DAY.
 * Relationship scores weight sort only — never hard-veto (nemesis eligible).
 */
export async function maybeEnqueueNpcMutualChat(input: {
  roomId: string;
  npcs: readonly MutualChatNpcPos[];
  absoluteGameMinute?: number;
  /** Minute-of-day for schedule filter (defaults to abs % MINUTES_PER_DAY). */
  gameMinuteOfDay?: number;
  busyNpcIds?: ReadonlySet<string> | ReadonlyMap<string, string>;
  npcSpeakInFlight?: boolean;
  /** Optional affection/trust-style scores keyed `npcA:npcB` (normalized). Weight only. */
  relationshipScores?: ReadonlyMap<string, number>;
  /** Bypass hash selectPct — enqueue all eligible under daily cap (tests). */
  forceSelectAllEligible?: boolean;
  /** Default true: both schedules must be in village-band zones. */
  villageBandOnly?: boolean;
  /** Build candidates only; do not claim/enqueue. */
  dryRun?: boolean;
}): Promise<{
  enqueued: string[];
  deferred: boolean;
  dayIndex: number;
  candidates: MutualChatCandidate[];
}> {
  if (input.npcSpeakInFlight) {
    return { enqueued: [], deferred: true, dayIndex: -1, candidates: [] };
  }

  const abs =
    input.absoluteGameMinute ?? getRoomVoteState(input.roomId).absoluteGameMinute;
  const dayIndex = dayIndexFromAbsoluteMinute(abs);
  if (dayIndex <= 0) {
    return { enqueued: [], deferred: false, dayIndex, candidates: [] };
  }

  const gameMinuteOfDay =
    input.gameMinuteOfDay ?? Math.floor(Math.max(0, abs) % MINUTES_PER_DAY);
  const villageBandOnly = input.villageBandOnly !== false;
  const busy = input.busyNpcIds;
  const isBusy = (id: string): boolean => Boolean(busy?.has(id));

  const council = input.npcs.filter(
    (n) => isCouncilNpcId(n.id) && !isBusy(n.id),
  );

  const rdKey = roomDayKey(input.roomId, dayIndex);
  let remaining = MUTUAL_CHAT_MAX_PER_DAY - (countByRoomDay.get(rdKey) ?? 0);
  if (remaining <= 0 && !input.dryRun) {
    return { enqueued: [], deferred: false, dayIndex, candidates: [] };
  }

  type Pair = {
    a: MutualChatNpcPos;
    b: MutualChatNpcPos;
    weight: number;
  };
  const pairs: Pair[] = [];

  for (let i = 0; i < council.length; i++) {
    for (let j = i + 1; j < council.length; j++) {
      const a = council[i]!;
      const b = council[j]!;
      if (chebyshev(a.x, a.y, b.x, b.y) > MUTUAL_CHEBYSHEV_MAX) continue;
      // forceSelectAllEligible skips bucket so tests can assert filter/weight without rotation.
      if (
        !input.forceSelectAllEligible &&
        !pairInDailyBucket(a.id, b.id, dayIndex)
      ) {
        continue;
      }
      if (
        !schedulesOverlapAndAvailable(
          a.id,
          b.id,
          gameMinuteOfDay,
          villageBandOnly,
        )
      ) {
        continue;
      }
      const { npcAId, npcBId } = normalizeEdgeIds(a.id, b.id);
      const claim = pairClaimKey(input.roomId, dayIndex, a.id, b.id);
      if (pairClaims.has(claim)) continue;

      if (!input.forceSelectAllEligible) {
        const roll =
          stableStringHash(
            `mutual-chat:${input.roomId}:${dayIndex}:${npcAId}:${npcBId}`,
          ) % 100;
        if (roll >= MUTUAL_SELECT_PCT) continue;
      }

      const rel =
        input.relationshipScores?.get(scoreKey(a.id, b.id)) ??
        input.relationshipScores?.get(`${a.id}:${b.id}`) ??
        0;
      // Higher affection → higher priority; negative (nemesis) still eligible, just lower weight.
      const weight = rel + (stableStringHash(`${npcAId}:${npcBId}:${dayIndex}`) % 7);
      pairs.push({ a, b, weight });
    }
  }

  pairs.sort((x, y) => y.weight - x.weight);

  const candidates: MutualChatCandidate[] = pairs.map((p) => {
    const { npcAId, npcBId } = normalizeEdgeIds(p.a.id, p.b.id);
    return { npcAId, npcBId, weight: p.weight };
  });

  if (input.dryRun) {
    return { enqueued: [], deferred: false, dayIndex, candidates };
  }

  const enqueued: string[] = [];
  for (const { a, b } of pairs) {
    if (remaining <= 0) break;
    const claim = pairClaimKey(input.roomId, dayIndex, a.id, b.id);
    if (pairClaims.has(claim)) continue;

    // Claim before awaiting enqueue so same-tick ambient dyad selection
    // observes mutual-chat supersession; roll back if enqueue fails.
    pairClaims.add(claim);
    let jobId: string | null = null;
    try {
      jobId = await enqueueNpcMutualChatJob({
        roomId: input.roomId,
        npcAId: a.id,
        npcBId: b.id,
        dayIndex,
        absoluteGameMinute: abs,
      });
    } catch (err) {
      pairClaims.delete(claim);
      throw err;
    }
    if (!jobId) {
      pairClaims.delete(claim);
      continue;
    }

    enqueued.push(jobId);
    remaining -= 1;
    countByRoomDay.set(rdKey, (countByRoomDay.get(rdKey) ?? 0) + 1);
  }

  return { enqueued, deferred: false, dayIndex, candidates };
}
