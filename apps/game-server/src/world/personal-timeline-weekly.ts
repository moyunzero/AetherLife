/**
 * Weekly personal-timeline digest enqueue (D-GEN-01/04).
 * Stagger ≈1–2 NPCs per SSOT game day across 12 seats; no LLM in tick.
 */

import {
  COUNCIL_NPC_IDS,
  MINUTES_PER_DAY,
  mainNpcDisplayName,
} from "@aetherlife/shared";
import { enqueuePersonalTimelineWeeklyJob } from "../queue/personal-timeline.js";
import { listRelationshipsForRoom } from "./npc-relationships-repository.js";
import { listPersonalTimelineForNpc } from "./personal-timeline-repository.js";
import { getRoomVoteState } from "./world-vote-state.js";
import { listWorldHistory } from "./world-history-repository.js";

/** Last dayIndex for which weekly jobs were enqueued (per room). */
const lastWeeklyDayByRoom = new Map<string, number>();

export function dayIndexFromAbsoluteMinute(absoluteGameMinute: number): number {
  return Math.floor(Math.max(0, absoluteGameMinute) / MINUTES_PER_DAY);
}

/** Seats whose weekly slot falls on this day-of-week (seatIndex % 7 === dayIndex % 7). */
export function weeklySeatsForDayIndex(dayIndex: number): readonly string[] {
  const dow = ((dayIndex % 7) + 7) % 7;
  return COUNCIL_NPC_IDS.filter((_, i) => i % 7 === dow);
}

export function clearPersonalTimelineWeeklyState(): void {
  lastWeeklyDayByRoom.clear();
}

function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

/**
 * Assemble weekly digest clues: world history + own timeline + edges + peer relationship diaries.
 */
export async function assembleWeeklyRecentBullets(
  roomId: string,
  npcId: string,
): Promise<string[]> {
  const bullets: string[] = [];

  try {
    const wh = await listWorldHistory({ roomId, page: 1, pageSize: 3, status: "all" });
    for (const e of wh.entries.slice(0, 3)) {
      bullets.push(`编年：${clip(e.title, 80)}`);
    }
  } catch {
    // best-effort clues
  }

  try {
    const tl = await listPersonalTimelineForNpc({ roomId, npcId, limit: 5 });
    for (const e of tl.entries) {
      const prefix = e.tag === "relationship" ? "关系记" : "自叙";
      bullets.push(`${prefix}：${clip(e.body, 60)}`);
    }
  } catch {
    // best-effort
  }

  let edges: Awaited<ReturnType<typeof listRelationshipsForRoom>> = [];
  try {
    edges = await listRelationshipsForRoom(roomId, { npcId, limit: 5 });
    for (const edge of edges) {
      const other = edge.npcAId === npcId ? edge.npcBId : edge.npcAId;
      const hist = edge.historySummary ? clip(edge.historySummary, 40) : "";
      bullets.push(
        `关系边：与${mainNpcDisplayName(other)} affection=${edge.affection}` +
          (hist ? ` ${hist}` : ""),
      );
    }
  } catch {
    // best-effort
  }

  for (const edge of edges.slice(0, 3)) {
    const peer = edge.npcAId === npcId ? edge.npcBId : edge.npcAId;
    try {
      const peerTl = await listPersonalTimelineForNpc({
        roomId,
        npcId: peer,
        limit: 8,
      });
      const relSnips = peerTl.entries
        .filter((e) => e.tag === "relationship")
        .slice(0, 2);
      for (const e of relSnips) {
        bullets.push(
          `同僚札记：${mainNpcDisplayName(peer)}：${clip(e.body, 50)}`,
        );
      }
    } catch {
      // best-effort
    }
  }

  return bullets.slice(0, 12);
}

/**
 * When dayIndex advances, enqueue weekly digest for staggered seats (≈1–2 NPCs/day).
 * Safe to call every ambient tick — idempotent per room+dayIndex.
 */
export async function maybeEnqueuePersonalTimelineWeekly(input: {
  roomId: string;
  absoluteGameMinute?: number;
  npcSpeakInFlight?: boolean;
}): Promise<{ enqueued: string[]; dayIndex: number }> {
  if (input.npcSpeakInFlight) {
    return { enqueued: [], dayIndex: -1 };
  }

  const abs =
    input.absoluteGameMinute ??
    getRoomVoteState(input.roomId).absoluteGameMinute;
  const dayIndex = dayIndexFromAbsoluteMinute(abs);
  if (dayIndex <= 0) {
    return { enqueued: [], dayIndex };
  }

  const prev = lastWeeklyDayByRoom.get(input.roomId);
  if (prev === dayIndex) {
    return { enqueued: [], dayIndex };
  }
  lastWeeklyDayByRoom.set(input.roomId, dayIndex);

  const seats = weeklySeatsForDayIndex(dayIndex);
  const enqueued: string[] = [];
  for (const npcId of seats) {
    const recentBullets = await assembleWeeklyRecentBullets(input.roomId, npcId);
    const jobId = await enqueuePersonalTimelineWeeklyJob({
      roomId: input.roomId,
      npcId,
      aetherEpochMinute: abs,
      dayIndex,
      recentBullets,
    });
    if (jobId) enqueued.push(jobId);
  }
  return { enqueued, dayIndex };
}
