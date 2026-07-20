/**
 * Non-vote dyad personal-timeline events (speak-mention + ambient co-presence).
 * Enqueues kind=event only — no LLM in game-server tick/speak path.
 */

import {
  COUNCIL_NPC_IDS,
  MINUTES_PER_DAY,
  isCouncilNpcId,
  mainNpcDisplayName,
  normalizeEdgeIds,
  stableStringHash,
} from "@aetherlife/shared";
import { enqueuePersonalTimelineEventJob } from "../queue/personal-timeline.js";
import { getRoomVoteState } from "./world-vote-state.js";

const DYAD_CHEBYSHEV_MAX = 2;
/** Max ambient dyad enqueues per room per SSOT day. */
const AMBIENT_MAX_PER_DAY = 2;
/** Ambient pair selection rate (~8%). */
const AMBIENT_SELECT_PCT = 8;

const dyadDayClaims = new Set<string>();
const ambientCountByRoomDay = new Map<string, number>();

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

export function clearPersonalTimelineDyadState(): void {
  dyadDayClaims.clear();
  ambientCountByRoomDay.clear();
}

/** First council peer mentioned in text (displayName or npc-N), excluding speaker. */
export function detectCouncilPeerMention(
  text: string,
  speakerNpcId: string,
): string | null {
  const hay = (text || "").trim();
  if (!hay) return null;
  for (const id of COUNCIL_NPC_IDS) {
    if (id === speakerNpcId) continue;
    const name = mainNpcDisplayName(id);
    if (hay.includes(id) || (name.length > 0 && hay.includes(name))) {
      return id;
    }
  }
  return null;
}

/** Keyword-biased small affection Δ for speak dyads (clamped ±3..±5). */
export function affectionDeltaFromSpeakText(text: string): number {
  const t = text || "";
  const negative = /争执|反对|愚蠢|叛徒|敌对|恨|怒|斥|骂/.test(t);
  const positive = /赞|敬|谢|友|同盟|支持|亲近|喜|夸/.test(t);
  if (negative && !positive) return -4;
  if (positive && !negative) return 4;
  return 3;
}

function truncateFact(text: string, max = 120): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

export async function maybeEnqueueDyadFromSpeak(input: {
  roomId: string;
  speakerNpcId: string;
  playerMessage: string;
  npcReply?: string;
  absoluteGameMinute?: number;
}): Promise<string | null> {
  if (!isCouncilNpcId(input.speakerNpcId)) return null;

  const combined = `${input.playerMessage}\n${input.npcReply ?? ""}`;
  const peer = detectCouncilPeerMention(combined, input.speakerNpcId);
  if (!peer) return null;

  const abs =
    input.absoluteGameMinute ?? getRoomVoteState(input.roomId).absoluteGameMinute;
  const dayIndex = dayIndexFromAbsoluteMinute(abs);
  if (dayIndex <= 0) return null;

  const claim = pairClaimKey(input.roomId, dayIndex, input.speakerNpcId, peer);
  if (dyadDayClaims.has(claim)) return null;
  dyadDayClaims.add(claim);

  const { npcAId, npcBId } = normalizeEdgeIds(input.speakerNpcId, peer);
  const eventAnchorId = `dyad-speak-${input.roomId}-${dayIndex}-${npcAId}-${npcBId}`;
  const factualSummary = truncateFact(
    `提及同僚：${truncateFact(combined, 100)}`,
  );
  const affectionDelta = affectionDeltaFromSpeakText(combined);

  const jobId = await enqueuePersonalTimelineEventJob({
    roomId: input.roomId,
    npcId: input.speakerNpcId,
    counterpartNpcId: peer,
    eventAnchorId,
    factualSummary,
    affectionDelta,
    aetherEpochMinute: abs,
    historyAppend: factualSummary,
  });
  if (!jobId) {
    // Durable claim already held — keep day claim to avoid spam.
    return null;
  }
  return jobId;
}

export type AmbientNpcPos = {
  id: string;
  x: number;
  y: number;
};

/**
 * Nearby council pairs (Chebyshev ≤2) — enqueue up to AMBIENT_MAX_PER_DAY per room/day.
 */
export async function maybeEnqueueDyadFromAmbient(input: {
  roomId: string;
  npcs: readonly AmbientNpcPos[];
  absoluteGameMinute?: number;
  busyNpcIds?: ReadonlySet<string> | ReadonlyMap<string, string>;
  /** Test override for hash selection rate (0–100). */
  selectPct?: number;
}): Promise<string[]> {
  const abs =
    input.absoluteGameMinute ?? getRoomVoteState(input.roomId).absoluteGameMinute;
  const dayIndex = dayIndexFromAbsoluteMinute(abs);
  if (dayIndex <= 0) return [];

  const selectPct = input.selectPct ?? AMBIENT_SELECT_PCT;
  const busy = input.busyNpcIds;
  const isBusy = (id: string): boolean => Boolean(busy?.has(id));

  const council = input.npcs.filter(
    (n) => isCouncilNpcId(n.id) && !isBusy(n.id),
  );
  const rdKey = roomDayKey(input.roomId, dayIndex);
  let remaining = AMBIENT_MAX_PER_DAY - (ambientCountByRoomDay.get(rdKey) ?? 0);
  if (remaining <= 0) return [];

  type Pair = { a: AmbientNpcPos; b: AmbientNpcPos; score: number };
  const pairs: Pair[] = [];
  for (let i = 0; i < council.length; i++) {
    for (let j = i + 1; j < council.length; j++) {
      const a = council[i]!;
      const b = council[j]!;
      if (chebyshev(a.x, a.y, b.x, b.y) > DYAD_CHEBYSHEV_MAX) continue;
      const { npcAId, npcBId } = normalizeEdgeIds(a.id, b.id);
      const claim = pairClaimKey(input.roomId, dayIndex, a.id, b.id);
      if (dyadDayClaims.has(claim)) continue;
      const score =
        stableStringHash(`dyad-ambient:${input.roomId}:${dayIndex}:${npcAId}:${npcBId}`) %
        100;
      if (score >= selectPct) continue;
      pairs.push({ a, b, score });
    }
  }
  pairs.sort((x, y) => x.score - y.score);

  const enqueued: string[] = [];
  for (const { a, b } of pairs) {
    if (remaining <= 0) break;
    const claim = pairClaimKey(input.roomId, dayIndex, a.id, b.id);
    if (dyadDayClaims.has(claim)) continue;
    dyadDayClaims.add(claim);

    const { npcAId, npcBId } = normalizeEdgeIds(a.id, b.id);
    const eventAnchorId = `dyad-ambient-${input.roomId}-${dayIndex}-${npcAId}-${npcBId}`;
    const nameA = mainNpcDisplayName(a.id);
    const nameB = mainNpcDisplayName(b.id);
    const factualSummary = `今日在地图近处相遇：${nameA} 与 ${nameB} 同席近邻。`;

    const jobId = await enqueuePersonalTimelineEventJob({
      roomId: input.roomId,
      npcId: a.id,
      counterpartNpcId: b.id,
      eventAnchorId,
      factualSummary,
      affectionDelta: 3,
      aetherEpochMinute: abs,
      historyAppend: factualSummary,
    });
    if (jobId) {
      enqueued.push(jobId);
      remaining -= 1;
      ambientCountByRoomDay.set(
        rdKey,
        (ambientCountByRoomDay.get(rdKey) ?? 0) + 1,
      );
    }
  }
  return enqueued;
}
