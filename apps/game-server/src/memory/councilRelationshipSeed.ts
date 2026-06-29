import {
  COUNCIL_NPC_IDS,
  councilIndexEdgeIds,
  getPersona,
  initialAffectionFromKind,
  initialTrustFromAffection,
  type CouncilNpcId,
} from "@aetherlife/shared";
import {
  countRelationshipsForRoom,
  councilRelationshipPairCount,
  insertRelationshipEdge,
  listRelationshipsForRoom,
} from "../world/npc-relationships-repository.js";

function registryEdgeForPair(
  npcA: CouncilNpcId,
  npcB: CouncilNpcId,
): { kind: string; summary: string } {
  const councilOrder = councilIndexEdgeIds(npcA, npcB);
  const personaA = getPersona(councilOrder.npcAId as CouncilNpcId);
  const relA = personaA.relationships.find((r) => r.targetId === councilOrder.npcBId);
  if (relA) {
    return { kind: relA.kind, summary: relA.summary };
  }
  const personaB = getPersona(councilOrder.npcBId as CouncilNpcId);
  const relB = personaB.relationships.find((r) => r.targetId === councilOrder.npcAId);
  if (relB) {
    return { kind: relB.kind, summary: relB.summary };
  }
  return { kind: "peer", summary: "" };
}

const seedInflight = new Map<string, Promise<void>>();
const seedReadyRooms = new Set<string>();

async function seedCouncilRelationshipsInner(roomId: string): Promise<void> {
  if (seedReadyRooms.has(roomId)) return;

  const expected = councilRelationshipPairCount();
  if ((await countRelationshipsForRoom(roomId)) >= expected) {
    seedReadyRooms.add(roomId);
    return;
  }

  for (let i = 0; i < COUNCIL_NPC_IDS.length; i++) {
    for (let j = i + 1; j < COUNCIL_NPC_IDS.length; j++) {
      const npcA = COUNCIL_NPC_IDS[i]!;
      const npcB = COUNCIL_NPC_IDS[j]!;
      const { kind, summary } = registryEdgeForPair(npcA, npcB);
      const affection = initialAffectionFromKind(kind);
      const trust = initialTrustFromAffection(affection);
      await insertRelationshipEdge({
        roomId,
        npcAId: npcA,
        npcBId: npcB,
        baseTag: kind,
        affection,
        trust,
        historySummary: summary,
      });
    }
  }

  seedReadyRooms.add(roomId);
}

/**
 * Idempotent async seed of 66 council relationship edges per room (C(12,2)).
 * Skips when countRelationshipsForRoom(roomId) >= 66.
 */
export async function seedCouncilRelationshipsIfNeeded(roomId: string): Promise<void> {
  let inflight = seedInflight.get(roomId);
  if (!inflight) {
    inflight = seedCouncilRelationshipsInner(roomId).finally(() => {
      seedInflight.delete(roomId);
    });
    seedInflight.set(roomId, inflight);
  }
  await inflight;
}

/** Test helper — clears in-process relationship seed short-circuit. */
export function clearCouncilRelationshipSeedCache(): void {
  seedReadyRooms.clear();
  seedInflight.clear();
}

export async function listSeededEdgesForRoom(roomId: string) {
  return listRelationshipsForRoom(roomId);
}
