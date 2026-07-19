/**
 * Weekly personal-timeline digest enqueue (D-GEN-01/04).
 * Stagger ≈1–2 NPCs per SSOT game day across 12 seats; no LLM in tick.
 */

import { COUNCIL_NPC_IDS, MINUTES_PER_DAY } from "@aetherlife/shared";
import { enqueuePersonalTimelineWeeklyJob } from "../queue/personal-timeline.js";
import { getRoomVoteState } from "./world-vote-state.js";

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
    const jobId = await enqueuePersonalTimelineWeeklyJob({
      roomId: input.roomId,
      npcId,
      aetherEpochMinute: abs,
      dayIndex,
    });
    if (jobId) enqueued.push(jobId);
  }
  return { enqueued, dayIndex };
}
