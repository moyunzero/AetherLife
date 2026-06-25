import type { CouncilPersona } from "../types.js";
import type { CouncilNpcId } from "../constants.js";
import { NPC_1_DOSSIER } from "./npc-1.js";
import { NPC_2_DOSSIER } from "./npc-2.js";
import { NPC_3_DOSSIER } from "./npc-3.js";
import { NPC_4_DOSSIER } from "./npc-4.js";
import { NPC_5_DOSSIER } from "./npc-5.js";
import { NPC_6_DOSSIER } from "./npc-6.js";
import { NPC_7_DOSSIER } from "./npc-7.js";
import { NPC_8_DOSSIER } from "./npc-8.js";
import { NPC_9_DOSSIER } from "./npc-9.js";
import { NPC_10_DOSSIER } from "./npc-10.js";
import { NPC_11_DOSSIER } from "./npc-11.js";
import { NPC_12_DOSSIER } from "./npc-12.js";

export { NPC_1_DOSSIER } from "./npc-1.js";
export { NPC_2_DOSSIER } from "./npc-2.js";
export { NPC_3_DOSSIER } from "./npc-3.js";
export { NPC_4_DOSSIER } from "./npc-4.js";
export { NPC_5_DOSSIER } from "./npc-5.js";
export { NPC_6_DOSSIER } from "./npc-6.js";
export { NPC_7_DOSSIER } from "./npc-7.js";
export { NPC_8_DOSSIER } from "./npc-8.js";
export { NPC_9_DOSSIER } from "./npc-9.js";
export { NPC_10_DOSSIER } from "./npc-10.js";
export { NPC_11_DOSSIER } from "./npc-11.js";
export { NPC_12_DOSSIER } from "./npc-12.js";

/** Full 12-seat council persona registry (npc-1…npc-12). */
export const COUNCIL_PERSONAS: Record<CouncilNpcId, CouncilPersona> = {
  "npc-1": NPC_1_DOSSIER,
  "npc-2": NPC_2_DOSSIER,
  "npc-3": NPC_3_DOSSIER,
  "npc-4": NPC_4_DOSSIER,
  "npc-5": NPC_5_DOSSIER,
  "npc-6": NPC_6_DOSSIER,
  "npc-7": NPC_7_DOSSIER,
  "npc-8": NPC_8_DOSSIER,
  "npc-9": NPC_9_DOSSIER,
  "npc-10": NPC_10_DOSSIER,
  "npc-11": NPC_11_DOSSIER,
  "npc-12": NPC_12_DOSSIER,
};

export function lookupPersona(npcId: CouncilNpcId): CouncilPersona | undefined {
  return COUNCIL_PERSONAS[npcId];
}
