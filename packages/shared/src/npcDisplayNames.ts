import { COUNCIL_NPC_IDS, getPersona, isCouncilNpcId } from "./council/constants.js";

/** @deprecated Use getPersona(id).displayName — derived from LOCKED dossiers for legacy imports. */
export const MAIN_NPC_DISPLAY_NAMES: Record<string, string> = Object.fromEntries(
  COUNCIL_NPC_IDS.map((id) => [id, getPersona(id).displayName]),
);

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
