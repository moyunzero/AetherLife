import {
  COUNCIL_MEMORY_PLAYER_ID,
  COUNCIL_NPC_IDS,
  getPersona,
} from "@aetherlife/shared";
import { MemoryService } from "./service.js";

/** Fixed importance for static council LTM seeds (D-MEM-02, D-MEM-05). */
const COUNCIL_SEED_IMPORTANCE = 9;

function councilSeedTextsForNpc(npcId: (typeof COUNCIL_NPC_IDS)[number]): string[] {
  const persona = getPersona(npcId);
  const texts: string[] = [];
  if (persona.stanceManifestoShort) {
    texts.push(persona.stanceManifestoShort);
  }
  if (persona.ltmSeeds?.length) {
    texts.push(...persona.ltmSeeds);
  }
  return texts;
}

/**
 * Idempotent async seed of council-scoped LTM for all 12 seats.
 * Skips npc when any __council__ row already exists for (roomId, npcId).
 */
export async function seedCouncilMemoriesIfNeeded(roomId: string): Promise<void> {
  const service = MemoryService.getInstance();

  for (const npcId of COUNCIL_NPC_IDS) {
    const existing = await service.getMemoryCount(roomId, npcId, COUNCIL_MEMORY_PLAYER_ID);
    if (existing > 0) continue;

    for (const text of councilSeedTextsForNpc(npcId)) {
      await service.appendNpcMemory(
        roomId,
        text,
        npcId,
        COUNCIL_MEMORY_PLAYER_ID,
        COUNCIL_SEED_IMPORTANCE,
      );
    }
  }
}
