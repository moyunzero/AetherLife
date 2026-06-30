/**
 * Beginning Fields spawn constants for Node verify scripts.
 * Keep in sync with `packages/shared/src/homeMap.ts`.
 *
 * Phase 26+: council room NPC homes come from `councilSpawns` shuffle —
 * use `councilNpcHome(roomId, npcId)` in `scripts/lib/council-spawn.mjs`, not HOME_NPC_SPAWNS.
 */
export const HOME_MAP_TILE_W = 40;
export const HOME_MAP_TILE_H = 40;
export const HOME_DEFAULT_PLAYER_SPAWN = { x: 34, y: 13 };

export const HOME_NPC_SPAWNS = {
  "npc-1": { x: 23, y: 10 },
  "npc-2": { x: 9, y: 21 },
  "npc-3": { x: 28, y: 27 },
};
