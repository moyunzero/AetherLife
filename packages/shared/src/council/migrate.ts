import { isBackgroundNpcId } from "../backgroundNpc.js";
import { createDefaultRoom, type RoomState } from "../room.js";
import { COUNCIL_NPC_IDS } from "./constants.js";

export type CouncilRoomMigrationResult = {
  state: RoomState;
  changed: boolean;
  reason: "already-12-council" | "migrated-to-12-council";
};

function isLegacyCouncilRoom(npcs: RoomState["npcs"]): boolean {
  const ids = new Set(npcs.map((n) => n.id));
  const hasBg = [...ids].some((id) => isBackgroundNpcId(id));
  const councilCount = COUNCIL_NPC_IDS.filter((id) => ids.has(id)).length;
  return councilCount < 12 || hasBg;
}

/**
 * Legacy 3-seat (+ bg-villager) room → 12 council NPCs.
 * Preserves coordinates for existing council ids; strips bg-villager tier.
 */
export function migrateRoomCouncilNpcs(state: RoomState): CouncilRoomMigrationResult {
  if (!isLegacyCouncilRoom(state.npcs)) {
    return { state, changed: false, reason: "already-12-council" };
  }

  const preserved = new Map(
    state.npcs
      .filter((n) => COUNCIL_NPC_IDS.includes(n.id as (typeof COUNCIL_NPC_IDS)[number]))
      .map((n) => [n.id, n]),
  );

  const fresh = createDefaultRoom(state.roomId);
  const npcs = fresh.npcs.map((seed) => {
    const existing = preserved.get(seed.id);
    if (!existing) return seed;
    return {
      ...seed,
      x: existing.x,
      y: existing.y,
      homeX: existing.homeX ?? seed.homeX,
      homeY: existing.homeY ?? seed.homeY,
      status: existing.status,
      inventory: existing.inventory,
      activityKey: existing.activityKey,
      intentReasonZh: existing.intentReasonZh,
      joinVicinityActive: existing.joinVicinityActive,
      joinVicinityUntil: existing.joinVicinityUntil,
      joinVicinityStartedAt: existing.joinVicinityStartedAt,
      joinVicinityPlayerId: existing.joinVicinityPlayerId,
    };
  });

  return {
    state: { ...state, npcs },
    changed: true,
    reason: "migrated-to-12-council",
  };
}
