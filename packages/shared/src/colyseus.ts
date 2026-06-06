/** Colyseus room name — must match game-server define() */
export const COLYSEUS_ROOM_NAME = "game_room" as const;

/** Max concurrent clients per room (Phase 8 SYNC-02) */
export const COLYSEUS_MAX_CLIENTS = 4 as const;

/** Join rejection hint for web UI (WebSocket close reason string) */
export const COLYSEUS_ROOM_FULL_CODE = "room_full" as const;

/** WebSocket close code when map room is at maxClients */
export const COLYSEUS_ROOM_FULL_WS_CODE = 4003 as const;

/** WebSocket close code when client landed on a duplicate orphan shard */
export const COLYSEUS_ORPHAN_SHARD_WS_CODE = 4004 as const;

export type Facing = "n" | "e" | "s" | "w";

export const COLYSEUS_CLIENT_MESSAGES = {
  move: "move",
  speak: "speak",
  /** Re-request loaded chunk views after join (initial chunksSync may arrive before listener). */
  requestChunksSync: "requestChunksSync",
} as const;

export const COLYSEUS_SERVER_MESSAGES = {
  thinking: "thinking",
  done: "done",
  error: "error",
  moveAck: "moveAck",
  patch: "patch",
  speakBusy: "speakBusy",
  speakIdle: "speakIdle",
  chunksSync: "chunksSync",
  loreSync: "loreSync",
} as const;

export type ColyseusMovePayload =
  | { dx: number; dy: number; clientSeq?: number }
  | { targetX: number; targetY: number; clientSeq?: number };

export type ColyseusSpeakPayload = { text: string; npcId: string; playerId: string };

export type ColyseusMoveAckPayload = {
  clientSeq: number;
  x: number;
  y: number;
  facing: Facing;
};

export type StatePatchNpcDelta = { id: string; x: number; y: number };

export type StatePatchPayload = {
  stateVersion: number;
  npcId?: string;
  delta: {
    npcs?: StatePatchNpcDelta[];
    doorOpen?: boolean;
  };
};

export type ColyseusSpeakBusyPayload = {
  reason: "npc_busy" | "room_queue";
  npcId?: string;
};

/** Broadcast when an NPC finishes processing and accepts new speak requests. */
export type ColyseusSpeakIdlePayload = {
  npcId: string;
};

/** Loaded chunk tile window for client render (Phase 10). */
export type ColyseusChunksSyncPayload = {
  chunks: import("./chunk.js").ChunkView[];
};

import type { ChunkLorePublic } from "./worldLore.js";

export type ChunkLoreStatus = "home" | "pending" | "ready" | "void" | "failed";

export type { ChunkLorePublic } from "./worldLore.js";

export type ColyseusLoreSyncPayload = {
  entries: Array<{
    cx: number;
    cy: number;
    status: ChunkLoreStatus;
    lore?: ChunkLorePublic;
    /** True only for the session/player that triggered first enqueue (D-06). */
    isFirstDiscover?: boolean;
  }>;
};
