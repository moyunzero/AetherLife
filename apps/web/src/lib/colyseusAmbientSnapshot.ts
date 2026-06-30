import { COUNCIL_NPC_IDS, formatGameClock } from "@aetherlife/shared";

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

export type CouncilNpcSnapshot = {
  id: string;
  x: number;
  y: number;
  activityKey: string;
  intentReasonZh: string;
  joinVicinityActive: boolean;
  joinVicinityUntil: number;
  joinVicinityStartedAt: number;
  isThinking: boolean;
  isSpeaking: boolean;
};

type NpcMapEntry = {
  x: number;
  y: number;
  activityKey?: string;
  intentReasonZh?: string;
  joinVicinityActive?: boolean;
  joinVicinityUntil?: number;
  joinVicinityStartedAt?: number;
  isThinking?: boolean;
  isSpeaking?: boolean;
};

type NpcMap = {
  forEach?: (fn: (npc: NpcMapEntry, npcId: string) => void) => void;
  $items?: Map<string, NpcMapEntry>;
};

type AmbientSchemaState = {
  gameMinute?: number;
  npcs?: NpcMap;
};

function snapshotNpcFromEntry(npcId: string, entry: NpcMapEntry): CouncilNpcSnapshot {
  return {
    id: npcId,
    x: entry.x,
    y: entry.y,
    activityKey: entry.activityKey ?? "idle",
    intentReasonZh: entry.intentReasonZh ?? "",
    joinVicinityActive: entry.joinVicinityActive ?? false,
    joinVicinityUntil: entry.joinVicinityUntil ?? 0,
    joinVicinityStartedAt: entry.joinVicinityStartedAt ?? 0,
    isThinking: entry.isThinking ?? false,
    isSpeaking: entry.isSpeaking ?? false,
  };
}

function iterateNpcMap(
  map: NpcMap | undefined,
  fn: (npcId: string, entry: NpcMapEntry) => void,
): void {
  if (!map) return;
  if (typeof map.forEach === "function") {
    map.forEach((entry, npcId) => fn(npcId, entry));
    return;
  }
  if (map.$items) {
    for (const [npcId, entry] of map.$items) {
      fn(npcId, entry);
    }
  }
}

/** Pure snapshot from Colyseus GameRoomState MapSchema npcs (ambient + speak sync). */
export function snapshotAmbientStateFromSchema(state: AmbientSchemaState): {
  gameClock: GameClockState;
  roomNpcs: CouncilNpcSnapshot[];
  npcActivityById: Record<string, string>;
  npcAmbientById: Record<string, NpcAmbientSnapshot>;
} {
  const minute = state.gameMinute ?? 360;
  const roomNpcs: CouncilNpcSnapshot[] = [];
  const npcAmbientById: Record<string, NpcAmbientSnapshot> = {};
  const npcActivityById: Record<string, string> = {};

  iterateNpcMap(state.npcs, (npcId, entry) => {
    const snap = snapshotNpcFromEntry(npcId, entry);
    roomNpcs.push(snap);
    npcAmbientById[npcId] = {
      activityKey: snap.activityKey,
      intentReasonZh: snap.intentReasonZh,
      joinVicinityActive: snap.joinVicinityActive,
      joinVicinityUntil: snap.joinVicinityUntil,
      joinVicinityStartedAt: snap.joinVicinityStartedAt,
    };
    npcActivityById[npcId] = snap.activityKey;
  });

  roomNpcs.sort(
    (a, b) =>
      COUNCIL_NPC_IDS.indexOf(a.id as (typeof COUNCIL_NPC_IDS)[number])
      - COUNCIL_NPC_IDS.indexOf(b.id as (typeof COUNCIL_NPC_IDS)[number]),
  );

  return {
    gameClock: { minute, label: formatGameClock(minute) },
    roomNpcs,
    npcActivityById,
    npcAmbientById,
  };
}
