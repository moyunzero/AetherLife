import { lookupPersona } from "./dossiers/index.js";
import type { CouncilPersona } from "./types.js";

export const COUNCIL_NPC_IDS = [
  "npc-1",
  "npc-2",
  "npc-3",
  "npc-4",
  "npc-5",
  "npc-6",
  "npc-7",
  "npc-8",
  "npc-9",
  "npc-10",
  "npc-11",
  "npc-12",
] as const;

export type CouncilNpcId = (typeof COUNCIL_NPC_IDS)[number];

/** Council-scoped memory player id — isolated from player speak memories (D-MEM-01). */
export const COUNCIL_MEMORY_PLAYER_ID = "__council__" as const;

export function isCouncilNpcId(npcId: string): npcId is CouncilNpcId {
  return (COUNCIL_NPC_IDS as readonly string[]).includes(npcId);
}

export function getPersona(npcId: string): CouncilPersona {
  if (!isCouncilNpcId(npcId)) {
    throw new Error(`getPersona: not a council npc id: ${npcId}`);
  }
  const persona = lookupPersona(npcId);
  if (!persona) {
    throw new Error(`getPersona: dossier not loaded for ${npcId}`);
  }
  return persona;
}
