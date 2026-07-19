/**
 * Personal Life Timeline — architecture reservation (Phase 27).
 * Calendar SSOT (D-CAL-01…07): civil year from 360-day years; month in labels.
 *
 * @see .planning/phases/27-personal-life-timeline/27-PRD.md
 * @see .planning/phases/23-council-persona-foundation/23-CONTEXT.md D-RESERVE-BIO-*
 */

import { checkPlayerMessageContent } from "./contentGuard.js";

/** SQL table name — dedicated store; not `npc_memories` / not `__council__`. */
export const NPC_PERSONAL_TIMELINE_TABLE = "npc_personal_timeline" as const;

/** Registry backstory era label for static seed entries (Phase 27 generator). */
export const AETHER_CALENDAR_EPOCH_YEAR = 0 as const;

export const MINUTES_PER_DAY = 1440 as const;
export const DAYS_PER_YEAR = 360 as const;
export const DAYS_PER_MONTH = 30 as const;

export const AETHER_SEASONS = ["春", "夏", "秋", "冬"] as const;
export type AetherSeason = (typeof AETHER_SEASONS)[number];

/** Display label: 太乙元年·春·1月·第1日 (year 0) or 太乙3年·秋·9月·第15日 */
export type AetherCalendarLabel =
  | `太乙元年·${AetherSeason}·${number}月·第${number}日`
  | `太乙${number}年·${AetherSeason}·${number}月·第${number}日`;

export type AetherCivilDate = {
  year: number;
  season: AetherSeason;
  month: number;
  dayOfMonth: number;
  minuteOfDay: number;
  dayIndex: number;
};

export const PERSONAL_TIMELINE_TAGS = [
  "daily",
  "adventure",
  "emotion",
  "conflict",
  "reflection",
  "relationship",
  "council",
] as const;

export type PersonalTimelineTag = (typeof PERSONAL_TIMELINE_TAGS)[number];

/** Cross-NPC shared event — same anchor, per-npc subjective body. */
export type PersonalTimelineEventAnchor = {
  anchorId: string;
  calendarLabel: AetherCalendarLabel;
  factualSummary: string;
};

export type PersonalTimelineSource =
  | "seed"
  | "llm_scheduled"
  | "llm_event"
  | "llm_reflection";

/**
 * Row shape for Phase 27 migration (append-only per room + npc).
 * `body` is first-person narrative from the NPC's perspective.
 */
export type PersonalTimelineEntry = {
  id: string;
  roomId: string;
  npcId: string;
  seq: number;
  calendarLabel: AetherCalendarLabel;
  aetherEpochMinute?: number;
  tag: PersonalTimelineTag;
  body: string;
  eventAnchorId?: string;
  factualSummary?: string;
  /** D-PROP-01: auto-true when tag is council|relationship or eventAnchorId set. */
  proposalEligible?: boolean;
  source: PersonalTimelineSource;
  createdAt: string;
};

/** Derive civil Aether calendar from monotonic epoch minutes (D-CAL-02/03). */
export function aetherCivilFromEpochMinute(epoch: number): AetherCivilDate {
  const e = Math.max(0, Math.floor(epoch));
  const minuteOfDay = e % MINUTES_PER_DAY;
  const dayIndex = Math.floor(e / MINUTES_PER_DAY);
  const year = Math.floor(dayIndex / DAYS_PER_YEAR);
  const dayInYear = dayIndex % DAYS_PER_YEAR;
  const month = Math.floor(dayInYear / DAYS_PER_MONTH) + 1;
  const dayOfMonth = (dayInYear % DAYS_PER_MONTH) + 1;
  const season = AETHER_SEASONS[Math.floor((month - 1) / 3)]!;
  return { year, season, month, dayOfMonth, minuteOfDay, dayIndex };
}

/** Unified display label including month (D-CAL-04 / BIO-02). */
export function formatAetherCalendarLabel(
  year: number,
  season: AetherSeason,
  month: number,
  dayOfMonth: number,
): AetherCalendarLabel {
  if (year === 0) {
    return `太乙元年·${season}·${month}月·第${dayOfMonth}日`;
  }
  return `太乙${year}年·${season}·${month}月·第${dayOfMonth}日`;
}

/** D-PROP-01: council|relationship tags or any eventAnchorId → proposalEligible. */
export function computeProposalEligible(input: {
  tag: PersonalTimelineTag;
  eventAnchorId?: string | null;
}): boolean {
  if (input.tag === "council" || input.tag === "relationship") return true;
  if (input.eventAnchorId != null && input.eventAnchorId !== "") return true;
  return false;
}

/** Returns first blocklist failure reason, or null if body passes. */
export function validatePersonalTimelineStrings(fields: {
  body: string;
  factualSummary?: string | null;
}): string | null {
  const texts = [fields.body];
  if (fields.factualSummary) texts.push(fields.factualSummary);
  for (const text of texts) {
    const result = checkPlayerMessageContent(text);
    if (!result.allowed) return result.reason;
  }
  return null;
}
