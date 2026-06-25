import { getPersona, isCouncilNpcId } from "./council/constants.js";

/** @deprecated Use getPersona(id).displayName — kept for legacy imports. */
export const MAIN_NPC_DISPLAY_NAMES: Record<string, string> = {
  "npc-1": "莫玄虚",
  "npc-2": "阿斯托利亚",
  "npc-3": "诸葛知危",
};

export function mainNpcDisplayName(npcId: string): string {
  if (isCouncilNpcId(npcId)) {
    try {
      return getPersona(npcId).displayName;
    } catch {
      return npcId;
    }
  }
  return npcId;
}
