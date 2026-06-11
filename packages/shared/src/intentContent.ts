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

function stripActivityPrefix(label: string): string {
  return label.startsWith("在") ? label.slice(1) : label;
}

/** True when reasonZh paraphrases the activity row — hide or replace third line. */
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
