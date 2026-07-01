/**
 * Council NPC home cells for verify/UAT scripts (Phase 26+).
 * SSOT: `createDefaultRoom` + embassy `councilSpawns` shuffle — not `HOME_NPC_SPAWNS`.
 *
 * Requires: `pnpm --filter @aetherlife/shared build` before import.
 */
import {
  createDefaultRoom,
  findNpc,
  COUNCIL_NPC_IDS,
} from "../../packages/shared/dist/index.js";

/** Assert room/API npc ids exactly match canonical 12 council seats. */
export function assertCanonicalCouncilRoster(ids) {
  const got = [...ids].sort();
  const want = [...COUNCIL_NPC_IDS].sort();
  if (got.length !== want.length || got.some((id, i) => id !== want[i])) {
    throw new Error(`council roster mismatch: got [${got.join(", ")}]`);
  }
}

export { COUNCIL_NPC_IDS };

/** Default grid home for a council npc after room reset / createDefaultRoom. */
export function councilNpcHome(roomId, npcId) {
  const room = createDefaultRoom(roomId);
  const npc = findNpc(room, npcId);
  if (!npc) {
    throw new Error(`councilNpcHome: ${npcId} missing in room ${roomId}`);
  }
  return { x: npc.x, y: npc.y };
}
