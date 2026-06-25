import type { CouncilPersona } from "../types.js";
import type { CouncilNpcId } from "../constants.js";
import { NPC_1_DOSSIER } from "./npc-1.js";
import { NPC_2_DOSSIER } from "./npc-2.js";
import { NPC_3_DOSSIER } from "./npc-3.js";

export { NPC_1_DOSSIER } from "./npc-1.js";
export { NPC_2_DOSSIER } from "./npc-2.js";
export { NPC_3_DOSSIER } from "./npc-3.js";

/** Partial registry — npc-4…12 land in plan 23-02. */
export const COUNCIL_PERSONAS: Partial<Record<CouncilNpcId, CouncilPersona>> = {
  "npc-1": NPC_1_DOSSIER,
  "npc-2": NPC_2_DOSSIER,
  "npc-3": NPC_3_DOSSIER,
};

export function lookupPersona(npcId: CouncilNpcId): CouncilPersona | undefined {
  return COUNCIL_PERSONAS[npcId];
}
