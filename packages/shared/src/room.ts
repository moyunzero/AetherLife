import { defaultBackgroundNpcStates } from "./backgroundNpc.js";
import { HOME_DEFAULT_PLAYER_SPAWN, HOME_MAP_TILE_H, HOME_MAP_TILE_W, HOME_NPC_SPAWNS } from "./homeMap.js";
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
  /** Wave 5 background tier — ambient wander only; no speak/worker. */
  isBackgroundNpc?: boolean;
  /** Zone id for rule-only wander (e.g. beginning-fields@v1:plaza). */
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

export function findNpc(room: RoomState, npcId: string): NpcState | undefined {
  return room.npcs.find((npc) => npc.id === npcId);
}

export function createDefaultRoom(roomId = "default"): RoomState {
  return {
    roomId,
    width: HOME_MAP_TILE_W,
    height: HOME_MAP_TILE_H,
    player: { ...HOME_DEFAULT_PLAYER_SPAWN },
    npcs: [
      {
        id: "npc-1",
        name: mainNpcDisplayName("npc-1"),
        ...HOME_NPC_SPAWNS["npc-1"],
        status: "idle",
        inventory: ["key-1"],
      },
      {
        id: "npc-2",
        name: mainNpcDisplayName("npc-2"),
        ...HOME_NPC_SPAWNS["npc-2"],
        status: "idle",
        inventory: ["key-2"],
      },
      {
        id: "npc-3",
        name: mainNpcDisplayName("npc-3"),
        ...HOME_NPC_SPAWNS["npc-3"],
        status: "idle",
        inventory: ["note-1"],
      },
      ...defaultBackgroundNpcStates(),
    ],
    objects: [],
  };
}
