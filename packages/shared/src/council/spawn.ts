import {
  BEGINNING_FIELDS_ID,
  defaultBeginningFieldsBundle,
  getRegionById,
  getWorldRegistry,
  loadWorldRegistry,
  setWorldRegistry,
  toGlobal,
  type WorldRegionId,
} from "../worldRegion.js";
import { COUNCIL_NPC_IDS, type CouncilNpcId } from "./constants.js";

export type CouncilSpawnSlot = {
  x: number;
  y: number;
  facing: string;
  maxRadius: number;
};

export type CouncilSpawnAssignment = {
  npcId: CouncilNpcId;
  slot: CouncilSpawnSlot;
};

function hashRoomSeed(roomId: string): number {
  let hash = 0;
  for (let i = 0; i < roomId.length; i += 1) {
    hash = (hash * 31 + roomId.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function ensureRegistry(): void {
  if (!getWorldRegistry()) {
    setWorldRegistry(loadWorldRegistry(defaultBeginningFieldsBundle()));
  }
}

/** Fisher–Yates shuffle with deterministic roomId seed (D-MAP-SPAWN-08). */
export function shuffleCouncilSpawnAssignments(
  roomId: string,
  slots: readonly CouncilSpawnSlot[],
): CouncilSpawnAssignment[] {
  if (slots.length !== COUNCIL_NPC_IDS.length) {
    throw new Error(
      `shuffleCouncilSpawnAssignments: expected ${COUNCIL_NPC_IDS.length} slots, got ${slots.length}`,
    );
  }

  const shuffledSlots = [...slots];
  let seed = hashRoomSeed(roomId);
  for (let i = shuffledSlots.length - 1; i > 0; i -= 1) {
    seed = (seed * 1103515245 + 12345) | 0;
    const j = Math.abs(seed) % (i + 1);
    [shuffledSlots[i], shuffledSlots[j]] = [shuffledSlots[j]!, shuffledSlots[i]!];
  }

  return COUNCIL_NPC_IDS.map((npcId, index) => ({
    npcId,
    slot: shuffledSlots[index]!,
  }));
}

/** Load embassy spawn slots for Beginning Fields (global gx, gy). */
export function getCouncilSpawnSlots(
  regionId: WorldRegionId = BEGINNING_FIELDS_ID,
): CouncilSpawnSlot[] {
  ensureRegistry();
  const registry = getWorldRegistry();
  const spawns = registry?.spawnsByRegion.get(regionId);
  if (!spawns?.councilSpawns?.length) {
    throw new Error(`getCouncilSpawnSlots: missing councilSpawns for ${regionId}`);
  }
  const region = getRegionById(regionId);
  if (!region) {
    throw new Error(`getCouncilSpawnSlots: unknown region ${regionId}`);
  }
  return spawns.councilSpawns.map((entry) => {
    const global = toGlobal(region, entry.x, entry.y);
    return {
      x: global.gx,
      y: global.gy,
      facing: entry.facing,
      maxRadius: entry.maxRadius,
    };
  });
}
