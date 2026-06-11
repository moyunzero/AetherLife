/** MVP ambient activity keys (14-UI-SPEC + unknown fallback). */
export const NPC_ACTIVITY_KEYS = [
  "idle",
  "wandering",
  "patrol",
  "fishing",
  "tending_crops",
  "watering",
  "chopping_wood",
  "reading",
  "cooking",
  "socializing",
  "resting",
  "at_poi",
  "stationary",
  "unknown",
] as const;

export type NpcActivityKey = (typeof NPC_ACTIVITY_KEYS)[number];

/** Server activityKey → proximity display copy (zh). idle = empty (UI hides row). */
export const NPC_ACTIVITY_LABEL_ZH: Record<NpcActivityKey, string> = {
  idle: "",
  wandering: "在闲逛",
  patrol: "在巡逻",
  fishing: "在钓鱼",
  tending_crops: "在照看作物",
  watering: "在浇水",
  chopping_wood: "在劈柴",
  reading: "在看书",
  cooking: "在做饭",
  socializing: "在与人闲聊",
  resting: "在休息",
  at_poi: "在附近转转",
  stationary: "在待着",
  unknown: "在忙别的",
};

const KNOWN_KEYS = new Set<string>(NPC_ACTIVITY_KEYS);

export function isKnownActivityKey(key: string): boolean {
  return KNOWN_KEYS.has(key);
}

export function activityDisplayZh(key: string): string {
  if (key in NPC_ACTIVITY_LABEL_ZH) {
    return NPC_ACTIVITY_LABEL_ZH[key as NpcActivityKey];
  }
  return NPC_ACTIVITY_LABEL_ZH.unknown;
}

/** Normalize game minute to 0–1439 and format as HH:MM (MVP clock HUD). */
export function formatGameClock(gameMinute: number): string {
  const normalized = ((gameMinute % 1440) + 1440) % 1440;
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}
