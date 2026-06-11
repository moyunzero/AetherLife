import type { NpcState } from "./room.js";
import type { WorldRegionId, ZoneId } from "./worldRegion.js";

/** Fixed background villager slots (Wave 5 — LIFE-EXT-01). */
export const BG_VILLAGER_IDS = [
  "bg-villager-1",
  "bg-villager-2",
  "bg-villager-3",
  "bg-villager-4",
] as const;

export type BgVillagerId = (typeof BG_VILLAGER_IDS)[number];

export type BackgroundNpcSpawn = {
  id: BgVillagerId;
  lx: number;
  ly: number;
  displayNameZh: string;
  wanderZoneId: ZoneId;
  activityKey?: string;
};

/**
 * Determines whether an NPC identifier corresponds to a background villager.
 *
 * @returns `true` if `npcId` starts with `"bg-villager-"`, `false` otherwise.
 */
export function isBackgroundNpcId(npcId: string): boolean {
  return npcId.startsWith("bg-villager-");
}

/**
 * Determine whether an NPC should be treated as a background NPC.
 *
 * @param npc - Object containing the NPC `id` and optional `isBackgroundNpc` flag used to evaluate background status
 * @returns `true` if the NPC is marked as a background NPC or its id indicates a background villager, `false` otherwise.
 */
export function isBackgroundNpc(npc: Pick<NpcState, "id" | "isBackgroundNpc">): boolean {
  return npc.isBackgroundNpc === true || isBackgroundNpcId(npc.id);
}

/** Default spawns for beginning-fields@v1 (lx/ly = global gx/gy when anchor is 0,0). */
export const DEFAULT_BACKGROUND_NPC_SPAWNS: readonly BackgroundNpcSpawn[] = [
  {
    id: "bg-villager-1",
    lx: 33,
    ly: 11,
    displayNameZh: "老张",
    wanderZoneId: "beginning-fields@v1:plaza" as ZoneId,
    activityKey: "wandering",
  },
  {
    id: "bg-villager-2",
    lx: 30,
    ly: 15,
    displayNameZh: "小满",
    wanderZoneId: "beginning-fields@v1:plaza" as ZoneId,
    activityKey: "wandering",
  },
  {
    id: "bg-villager-3",
    lx: 19,
    ly: 12,
    displayNameZh: "阿牛",
    wanderZoneId: "beginning-fields@v1:orchard" as ZoneId,
    activityKey: "wandering",
  },
  {
    id: "bg-villager-4",
    lx: 25,
    ly: 25,
    displayNameZh: "巧娘",
    wanderZoneId: "beginning-fields@v1:pond" as ZoneId,
    activityKey: "wandering",
  },
] as const;

/**
 * Create NpcState objects for background NPCs using spawn definitions and a region anchor.
 *
 * @param spawns - Spawn definitions containing local offsets, display name, wander zone, and optional activityKey
 * @param regionAnchor - Global coordinates ({ gx, gy }) used to convert each spawn's local `lx`/`ly` into world `x`/`y`
 * @returns An array of `NpcState` objects positioned relative to `regionAnchor`. Each state has `status` set to `"idle"`, an empty `inventory`, `isBackgroundNpc` set to `true`, `backgroundWanderZoneId` taken from the spawn, and `activityKey` set to the spawn's `activityKey` or `"wandering"` when absent.
 */
export function backgroundNpcStatesFromSpawns(
  spawns: readonly BackgroundNpcSpawn[],
  regionAnchor: { gx: number; gy: number },
): NpcState[] {
  return spawns.map((s) => ({
    id: s.id,
    name: s.displayNameZh,
    x: regionAnchor.gx + s.lx,
    y: regionAnchor.gy + s.ly,
    status: "idle",
    inventory: [],
    isBackgroundNpc: true,
    backgroundWanderZoneId: s.wanderZoneId,
    activityKey: s.activityKey ?? "wandering",
  }));
}

/**
 * Get the default background NPC states for a specified world region.
 *
 * @param regionId - The world region identifier to generate defaults for; defaults to `"beginning-fields@v1"`. Only `"beginning-fields@v1"` has predefined defaults.
 * @returns An array of `NpcState` objects for the region. Returns an empty array for regions without predefined background NPC spawns.
 */
export function defaultBackgroundNpcStates(regionId: WorldRegionId = "beginning-fields@v1"): NpcState[] {
  if (regionId !== "beginning-fields@v1") return [];
  return backgroundNpcStatesFromSpawns(DEFAULT_BACKGROUND_NPC_SPAWNS, { gx: 0, gy: 0 });
}
