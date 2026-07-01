import {
  BEGINNING_FIELDS_ID,
  getRegionById,
  regionAt,
} from "./worldRegion.js";

const beginningFields = getRegionById(BEGINNING_FIELDS_ID);

/** Beginning Fields Tiled map covers this many world grid cells (1 Tiled tile = 1 cell @ 32px). */
export const HOME_MAP_TILE_W = beginningFields?.size.w ?? 40;
export const HOME_MAP_TILE_H = beginningFields?.size.h ?? 40;

/** Bump when spawn coords change — invalidates client sessionStorage grid restore. */
export const HOME_SPAWN_CONFIG_VERSION = 12;

/** Default player spawn on Beginning Fields (Tiled tile coords = game gx, gy). */
export const HOME_DEFAULT_PLAYER_SPAWN = { x: 34, y: 13 } as const;

/** Default NPC home slots on Beginning Fields (Tiled tile coords). */
export const HOME_NPC_SPAWNS = {
  "npc-1": { x: 23, y: 10 },
  "npc-2": { x: 9, y: 21 },
  "npc-3": { x: 28, y: 27 },
} as const;

export type HomeNpcId = keyof typeof HOME_NPC_SPAWNS;

/** Colyseus join + HTTP room default player cell (alias for map.player). */
export function homeDefaultPlayerSpawn(): { x: number; y: number } {
  return { ...HOME_DEFAULT_PLAYER_SPAWN };
}

export function homeNpcSpawn(npcId: HomeNpcId): { x: number; y: number } {
  return { ...HOME_NPC_SPAWNS[npcId] };
}

/** True when (gx, gy) lies inside the one-city homestead background bounds. */
export function isHomeMapRegionCell(gx: number, gy: number): boolean {
  return regionAt(gx, gy)?.id === BEGINNING_FIELDS_ID;
}
