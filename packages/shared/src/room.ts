import {
  getCouncilSpawnSlots,
  shuffleCouncilSpawnAssignments,
} from "./council/spawn.js";
import {
  defaultBeginningFieldsBundle,
  loadWorldRegistry,
  setWorldRegistry,
} from "./worldRegion.js";
import { HOME_DEFAULT_PLAYER_SPAWN, HOME_MAP_TILE_H, HOME_MAP_TILE_W } from "./homeMap.js";
import { mainNpcDisplayName } from "./npcDisplayNames.js";

export type ObjectState = "open" | "closed" | "idle";

export type PlayerState = {
  x: number;
  y: number;
};

export type NpcState = {
  id: string;
  name: string;
  x: number;
  y: number;
  status: string;
  inventory: string[];
  /** Embassy home anchor for ambient soft tether (D-MAP-SPAWN-04). */
  homeX?: number;
  homeY?: number;
  maxRadius?: number;
  facing?: string;
  /** Ambient activity key (server-authoritative; optional until ambient tick writes). */
  activityKey?: string;
  /** Async ambient intent reason (max 32 chars); client subline in 16-08. */
  intentReasonZh?: string;
  /** join_vicinity UX — wall-clock ms window. */
  joinVicinityActive?: boolean;
  joinVicinityUntil?: number;
  joinVicinityStartedAt?: number;
  /** Player id to approach during join_vicinity (C-06). */
  joinVicinityPlayerId?: string;
  /** @deprecated Phase 26 — bg-villager tier removed; retained for migration reads only. */
  isBackgroundNpc?: boolean;
  /** @deprecated Phase 26 — bg-villager wander zones removed. */
  backgroundWanderZoneId?: string;
};

export type GameObject = {
  id: string;
  kind: string;
  x: number;
  y: number;
  state: ObjectState;
};

export type RoomState = {
  roomId: string;
  width: number;
  height: number;
  player: PlayerState;
  npcs: NpcState[];
  objects: GameObject[];
};

const LEGACY_STARTER_INVENTORY: Partial<Record<string, string[]>> = {
  "npc-1": ["key-1"],
  "npc-2": ["key-2"],
  "npc-3": ["note-1"],
};

function ensureCouncilSpawnsReady(): void {
  try {
    getCouncilSpawnSlots();
  } catch {
    setWorldRegistry(loadWorldRegistry(defaultBeginningFieldsBundle()));
  }
}

function councilRoomNpcs(roomId: string): NpcState[] {
  ensureCouncilSpawnsReady();
  const assignments = shuffleCouncilSpawnAssignments(roomId, getCouncilSpawnSlots());
  return assignments.map(({ npcId, slot }) => ({
    id: npcId,
    name: mainNpcDisplayName(npcId),
    x: slot.x,
    y: slot.y,
    homeX: slot.x,
    homeY: slot.y,
    maxRadius: slot.maxRadius,
    facing: slot.facing,
    status: "idle",
    inventory: LEGACY_STARTER_INVENTORY[npcId] ?? [],
    activityKey: "idle",
  }));
}

export function findNpc(room: RoomState, npcId: string): NpcState | undefined {
  return room.npcs.find((npc) => npc.id === npcId);
}

export function createDefaultRoom(roomId = "default"): RoomState {
  return {
    roomId,
    width: HOME_MAP_TILE_W,
    height: HOME_MAP_TILE_H,
    player: { ...HOME_DEFAULT_PLAYER_SPAWN },
    npcs: councilRoomNpcs(roomId),
    objects: [],
  };
}
