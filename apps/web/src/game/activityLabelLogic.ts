import { activityDisplayZh } from "@aetherlife/shared";
import { chebyshevDistance } from "./ProximityNameplate.js";

const PROXIMITY_CELLS = 2;

export type ShouldShowActivityParams = {
  gx: number;
  gy: number;
  localGx: number;
  localGy: number;
  npcId: string;
  activityKey: string;
  thinkingNpcId: string | null;
  activeNpcId: string | null;
  speakBusyNpcId: string | null;
};

export function truncateActivityLabel(text: string): string {
  if (text.length <= 12) return text;
  return `${text.slice(0, 11)}…`;
}

export function shouldShowActivity(params: ShouldShowActivityParams): boolean {
  const {
    gx,
    gy,
    localGx,
    localGy,
    npcId,
    activityKey,
    thinkingNpcId,
    activeNpcId,
    speakBusyNpcId,
  } = params;

  if (chebyshevDistance(gx, gy, localGx, localGy) > PROXIMITY_CELLS) return false;

  const key = activityKey.trim();
  if (!key || key === "idle") return false;

  const label = activityDisplayZh(key);
  if (!label) return false;

  if (npcId === thinkingNpcId) return false;

  if (speakBusyNpcId !== null && npcId === activeNpcId && speakBusyNpcId === npcId) {
    return false;
  }

  return true;
}
