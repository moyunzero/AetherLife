import {
  BG_VILLAGER_IDS,
  formatGameClock,
} from "@aetherlife/shared";

export type GameClockState = {
  minute: number;
  label: string;
};

export type NpcAmbientSnapshot = {
  activityKey: string;
  intentReasonZh: string;
  joinVicinityActive: boolean;
  joinVicinityUntil: number;
  joinVicinityStartedAt: number;
};

type AmbientSchemaState = {
  gameMinute?: number;
  npc1ActivityKey?: string;
  npc2ActivityKey?: string;
  npc3ActivityKey?: string;
  npc1IntentReasonZh?: string;
  npc2IntentReasonZh?: string;
  npc3IntentReasonZh?: string;
  npc1JoinVicinityActive?: boolean;
  npc2JoinVicinityActive?: boolean;
  npc3JoinVicinityActive?: boolean;
  npc1JoinVicinityUntil?: number;
  npc2JoinVicinityUntil?: number;
  npc3JoinVicinityUntil?: number;
  npc1JoinVicinityStartedAt?: number;
  npc2JoinVicinityStartedAt?: number;
  npc3JoinVicinityStartedAt?: number;
  npc1X?: number;
  npc1Y?: number;
  npc2X?: number;
  npc2Y?: number;
  npc3X?: number;
  npc3Y?: number;
  bgNpc1Active?: boolean;
  bgNpc2Active?: boolean;
  bgNpc3Active?: boolean;
  bgNpc4Active?: boolean;
  bgNpc1ActivityKey?: string;
  bgNpc2ActivityKey?: string;
  bgNpc3ActivityKey?: string;
  bgNpc4ActivityKey?: string;
  bgNpc1X?: number;
  bgNpc1Y?: number;
  bgNpc2X?: number;
  bgNpc2Y?: number;
  bgNpc3X?: number;
  bgNpc3Y?: number;
  bgNpc4X?: number;
  bgNpc4Y?: number;
};

/**
 * Creates an ambient snapshot for the specified main NPC slot.
 *
 * @param state - Colyseus schema state object containing NPC ambient fields
 * @param prefix - The main NPC slot to read (`"npc1"`, `"npc2"`, or `"npc3"`)
 * @returns An `NpcAmbientSnapshot` for that slot. Fields default as follows when missing: `activityKey` => `"idle"`, `intentReasonZh` => `""`, `joinVicinityActive` => `false`, `joinVicinityUntil` => `0`, `joinVicinityStartedAt` => `0`
 */
function snapshotNpcAmbient(
  state: AmbientSchemaState,
  prefix: "npc1" | "npc2" | "npc3",
): NpcAmbientSnapshot {
  return {
    activityKey: state[`${prefix}ActivityKey`] ?? "idle",
    intentReasonZh: state[`${prefix}IntentReasonZh`] ?? "",
    joinVicinityActive: state[`${prefix}JoinVicinityActive`] ?? false,
    joinVicinityUntil: state[`${prefix}JoinVicinityUntil`] ?? 0,
    joinVicinityStartedAt: state[`${prefix}JoinVicinityStartedAt`] ?? 0,
  };
}

/**
 * Produce a pure snapshot of ambient NPC state and game clock derived from a Colyseus room schema.
 *
 * @param state - Colyseus schema object containing ambient/game-minute and per-NPC fields
 * @returns An object with:
 *   - `gameClock`: current game minute and its formatted label
 *   - `npcActivityById`: map of NPC id → activity key
 *   - `npcAmbientById`: per-NPC ambient snapshots (activity, intent, join-vicinity fields)
 *   - `mainNpcGridById`: positions for main NPCs keyed by NPC id when both X and Y are numeric
 *   - `bgNpcGridById`: positions for active background villager NPCs keyed by NPC id when both X and Y are numeric
 */
export function snapshotAmbientStateFromSchema(state: AmbientSchemaState): {
  gameClock: GameClockState;
  npcActivityById: Record<string, string>;
  npcAmbientById: Record<string, NpcAmbientSnapshot>;
  mainNpcGridById: Record<string, { x: number; y: number }>;
  bgNpcGridById: Record<string, { x: number; y: number }>;
} {
  const minute = state.gameMinute ?? 360;
  const npcAmbientById = {
    "npc-1": snapshotNpcAmbient(state, "npc1"),
    "npc-2": snapshotNpcAmbient(state, "npc2"),
    "npc-3": snapshotNpcAmbient(state, "npc3"),
  };
  const mainNpcGridById: Record<string, { x: number; y: number }> = {};
  const mainSlots: Array<[string, "npc1" | "npc2" | "npc3"]> = [
    ["npc-1", "npc1"],
    ["npc-2", "npc2"],
    ["npc-3", "npc3"],
  ];
  for (const [npcId, prefix] of mainSlots) {
    const x = state[`${prefix}X` as keyof AmbientSchemaState];
    const y = state[`${prefix}Y` as keyof AmbientSchemaState];
    if (typeof x === "number" && typeof y === "number") {
      mainNpcGridById[npcId] = { x, y };
    }
  }
  const bgNpcGridById: Record<string, { x: number; y: number }> = {};
  const bgSlots: Array<[string, "bgNpc1" | "bgNpc2" | "bgNpc3" | "bgNpc4"]> = [
    ["bg-villager-1", "bgNpc1"],
    ["bg-villager-2", "bgNpc2"],
    ["bg-villager-3", "bgNpc3"],
    ["bg-villager-4", "bgNpc4"],
  ];
  for (const [npcId, prefix] of bgSlots) {
    const active = state[`${prefix}Active` as keyof AmbientSchemaState];
    if (active === false) continue;
    const activityKey = state[`${prefix}ActivityKey` as keyof AmbientSchemaState] ?? "wandering";
    npcAmbientById[npcId] = {
      activityKey: typeof activityKey === "string" ? activityKey : "wandering",
      intentReasonZh: "",
      joinVicinityActive: false,
      joinVicinityUntil: 0,
      joinVicinityStartedAt: 0,
    };
    const x = state[`${prefix}X` as keyof AmbientSchemaState];
    const y = state[`${prefix}Y` as keyof AmbientSchemaState];
    if (typeof x === "number" && typeof y === "number") {
      bgNpcGridById[npcId] = { x, y };
    }
  }
  const npcActivityById: Record<string, string> = {
    "npc-1": npcAmbientById["npc-1"].activityKey,
    "npc-2": npcAmbientById["npc-2"].activityKey,
    "npc-3": npcAmbientById["npc-3"].activityKey,
  };
  for (const id of BG_VILLAGER_IDS) {
    if (npcAmbientById[id]) {
      npcActivityById[id] = npcAmbientById[id].activityKey;
    }
  }
  return {
    gameClock: { minute, label: formatGameClock(minute) },
    npcActivityById,
    npcAmbientById,
    mainNpcGridById,
    bgNpcGridById,
  };
}
