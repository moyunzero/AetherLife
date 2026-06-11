import { activityDisplayZh } from "./npcActivity.js";

/** Substrings that make reasonZh redundant with activity copy (motivation layer only). */
const ACTIVITY_FORBIDDEN_SUBSTRINGS: Record<string, string[]> = {
  reading: ["看书", "读"],
  patrol: ["巡逻", "四处看看", "看看"],
  wandering: ["闲逛", "逛逛"],
  fishing: ["钓鱼"],
  socializing: ["闲聊", "聊天", "聊聊"],
  tending_crops: ["作物", "照看"],
  watering: ["浇水"],
  chopping_wood: ["劈柴"],
  cooking: ["做饭"],
  resting: ["休息", "歇"],
  idle: ["闲着"],
};

/**
 * Remove a leading Chinese preposition "在" from an activity label if present.
 *
 * @param label - The activity display label to normalize
 * @returns The input label without a leading "在"; otherwise the original label
 */
function stripActivityPrefix(label: string): string {
  return label.startsWith("在") ? label.slice(1) : label;
}

/**
 * Determine whether a Chinese reason string duplicates an activity's display text or configured redundant fragments.
 *
 * @param activityKey - The activity identifier used to retrieve the Chinese display label and activity-specific forbidden fragments.
 * @param reasonZh - The Chinese reason text to evaluate for redundancy.
 * @returns `true` if `reasonZh` contains the activity display label (or the display label with a leading "在" removed) or any configured forbidden substring for the activity, `false` otherwise.
 */
export function isReasonZhRedundantWithActivity(activityKey: string, reasonZh: string): boolean {
  const trimmed = reasonZh.trim();
  if (!trimmed) return false;

  const display = activityDisplayZh(activityKey);
  if (display) {
    const core = stripActivityPrefix(display);
    if (core && trimmed.includes(core)) return true;
    if (trimmed.includes(display)) return true;
  }

  const forbidden = ACTIVITY_FORBIDDEN_SUBSTRINGS[activityKey] ?? [];
  return forbidden.some((frag) => frag.length > 0 && trimmed.includes(frag));
}
