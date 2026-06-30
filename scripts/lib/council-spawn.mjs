/**
 * Council NPC home cells for verify/UAT scripts (Phase 26+).
 * SSOT: `createDefaultRoom` + embassy `councilSpawns` shuffle — not `HOME_NPC_SPAWNS`.
 *
 * Requires: `pnpm --filter @aetherlife/shared build` before import.
 */
import {
  createDefaultRoom,
  findNpc,
} from "../../packages/shared/dist/index.js";

/** Default grid home for a council npc after room reset / createDefaultRoom. */
export function councilNpcHome(roomId, npcId) {
  const room = createDefaultRoom(roomId);
  const npc = findNpc(room, npcId);
  if (!npc) {
    throw new Error(`councilNpcHome: ${npcId} missing in room ${roomId}`);
  }
  return { x: npc.x, y: npc.y };
}
