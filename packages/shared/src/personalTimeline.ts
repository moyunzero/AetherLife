/**
 * Personal Life Timeline — architecture reservation (Phase 27).
 * Calendar SSOT (D-CAL-01…07): civil year from 360-day years; month in labels.
 *
 * Dual track (UAT revise):
 * - Pre-arrival lifeNodes → `生平·{age}` (independent lifetime; NOT 太乙)
 * - Post-arrival / shared world → `formatAetherCalendarLabel` (太乙元年 = 12-NPC gather start)
 *
 * @see .planning/phases/27-personal-life-timeline/27-PRD.md
 * @see .planning/phases/23-council-persona-foundation/23-CONTEXT.md D-RESERVE-BIO-*
 */

import { checkPlayerMessageContent } from "./contentGuard.js";

/** SQL table name — dedicated store; not `npc_memories` / not `__council__`. */
export const NPC_PERSONAL_TIMELINE_TABLE = "npc_personal_timeline" as const;

/** Registry backstory era label for static seed entries (Phase 27 generator). */
export const AETHER_CALENDAR_EPOCH_YEAR = 0 as const;

/**
 * Sort key base for pre-arrival seed rows stored in `aether_epoch_minute`.
 * Negatives sort before any post-arrival Aether clock (≥0). C-11 allows these;
 * not a civil calendar value.
 */
export const LIFETIME_EPOCH_MINUTE_BASE = -1_000_000 as const;

export const MINUTES_PER_DAY = 1440 as const;
export const DAYS_PER_YEAR = 360 as const;
export const DAYS_PER_MONTH = 30 as const;

export const AETHER_SEASONS = ["春", "夏", "秋", "冬"] as const;
export type AetherSeason = (typeof AETHER_SEASONS)[number];

/** Display label: 太乙元年·春·1月·第1日 (year 0) or 太乙3年·秋·9月·第15日 */
export type AetherCalendarLabel =
  | `太乙元年·${AetherSeason}·${number}月·第${number}日`
  | `太乙${number}年·${AetherSeason}·${number}月·第${number}日`;

/** Pre-arrival personal lifetime stamp — e.g. 生平·16岁 / 生平·派驻后 */
export type LifetimeCalendarLabel = `生平·${string}`;

/** Entry display stamp: lifetime (pre-gather) or Aether civil (post-gather). */
export type PersonalTimelineCalendarLabel =
  | AetherCalendarLabel
  | LifetimeCalendarLabel;

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

/** Cross-NPC shared event — same anchor, per-npc subjective body (post-arrival Aether). */
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
  calendarLabel: PersonalTimelineCalendarLabel;
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

/** Unified display label including month (D-CAL-04 / BIO-02). Post-arrival only. */
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

/** Pre-arrival lifeNode stamp — independent of 太乙 civil calendar. */
export function formatLifetimeCalendarLabel(age: string): LifetimeCalendarLabel {
  const trimmed = age.trim() || "未知";
  return `生平·${trimmed}`;
}

export function isLifetimeCalendarLabel(
  label: string,
): label is LifetimeCalendarLabel {
  return label.startsWith("生平·");
}

export function isAetherCalendarLabel(
  label: string,
): label is AetherCalendarLabel {
  return label.startsWith("太乙");
}

/** Sort key for lifeNode index `i` (0-based); always negative (before Aether clock). */
export function lifetimeEpochMinute(index: number): number {
  const i = Math.max(0, Math.floor(index));
  return LIFETIME_EPOCH_MINUTE_BASE + i;
}

/** D-PROP-01: council|relationship tags or any eventAnchorId → proposalEligible.
 * Seed life-nodes stay false (BIO-07) even when tag/anchor would otherwise qualify.
 */
export function computeProposalEligible(input: {
  tag: PersonalTimelineTag;
  eventAnchorId?: string | null;
  source?: PersonalTimelineSource;
}): boolean {
  if (input.source === "seed") return false;
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
