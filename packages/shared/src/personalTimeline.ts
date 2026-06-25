/**
 * Personal Life Timeline — architecture reservation (Phase 27).
 * Phase 23: types + constants only. No DB migration or LLM jobs yet.
 *
 * @see .planning/phases/27-personal-life-timeline/27-PRD.md
 * @see .planning/phases/23-council-persona-foundation/23-CONTEXT.md D-RESERVE-BIO-*
 */

/** SQL table name — dedicated store; not `npc_memories` / not `__council__`. */
export const NPC_PERSONAL_TIMELINE_TABLE = "npc_personal_timeline" as const;

/** Registry backstory era label for static seed entries (Phase 27 generator). */
export const AETHER_CALENDAR_EPOCH_YEAR = 0 as const;

export const AETHER_SEASONS = ["春", "夏", "秋", "冬"] as const;
export type AetherSeason = (typeof AETHER_SEASONS)[number];

/** Display label: 太乙元年·春·第7日 (year 0) or 太乙3年·春·第7日 */
export type AetherCalendarLabel =
  | `太乙元年·${AetherSeason}·第${number}日`
  | `太乙${number}年·${AetherSeason}·第${number}日`;

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
  tag: PersonalTimelineTag;
  body: string;
  eventAnchorId?: string;
  source: "seed" | "llm_scheduled" | "llm_event" | "llm_reflection";
  createdAt: string;
};

export function formatAetherCalendarLabel(
  year: number,
  season: AetherSeason,
  day: number,
): AetherCalendarLabel {
  if (year === 0) {
    return `太乙元年·${season}·第${day}日`;
  }
  return `太乙${year}年·${season}·第${day}日`;
}
