import {
  AETHER_NEXUS_LORE,
  COUNCIL_NPC_IDS,
  getPersona,
  type GenesisMinutes,
} from "@aetherlife/shared";
import {
  countGenesisEntries,
  insertWorldHistoryEntry,
  listWorldHistory,
  repairGenesisGameYear,
} from "./world-history-repository.js";

const GENESIS_PROPOSER = "议会共识";
const GENESIS_GAME_YEAR = 0;
const GENESIS_GAME_MINUTE = 0;

function buildGenesisSignatories(proposalFull: string): GenesisMinutes {
  const signatories = COUNCIL_NPC_IDS.map((npcId) => {
    const persona = getPersona(npcId);
    return {
      npcId,
      displayName: persona.displayName,
      faction: persona.faction,
      ...(persona.stanceManifestoShort
        ? { stanceManifestoShort: persona.stanceManifestoShort }
        : {}),
    };
  });

  return {
    kind: "genesis_signatories",
    proposalFull,
    signatories,
    footnote: "此条为奠基文献，非本届廷议表决。",
  };
}

const GENESIS_ROWS = [
  {
    title: "万界崩裂纪",
    proposal: AETHER_NEXUS_LORE.origin,
  },
  {
    title: "始源区辟",
    proposal: AETHER_NEXUS_LORE.beginningFieldsRole,
  },
  {
    title: "十二议会驻",
    proposal: AETHER_NEXUS_LORE.historyEvolution,
  },
] as const;

const seedInflight = new Map<string, Promise<void>>();
const genesisReadyRooms = new Set<string>();

async function seedWorldHistoryInner(roomId: string): Promise<void> {
  if (genesisReadyRooms.has(roomId)) return;
  if ((await countGenesisEntries(roomId)) >= 3) {
    // Legacy rooms may have 3 genesis rows stamped on a non-civil year — repair before exit.
    await repairGenesisGameYear(roomId, GENESIS_GAME_YEAR);
    genesisReadyRooms.add(roomId);
    return;
  }

  const { entries: existing } = await listWorldHistory({ roomId, status: "all" });
  const existingGenesisTitles = new Set(
    existing.filter((row) => row.entryKind === "genesis").map((row) => row.title),
  );

  for (const row of GENESIS_ROWS) {
    if (existingGenesisTitles.has(row.title)) continue;
    const minutes = buildGenesisSignatories(row.proposal);
    await insertWorldHistoryEntry({
      roomId,
      entryKind: "genesis",
      status: "accepted",
      title: row.title,
      proposal: row.proposal,
      proposerDisplayName: GENESIS_PROPOSER,
      yesCount: null,
      noCount: null,
      minutes,
      gameYear: GENESIS_GAME_YEAR,
      gameMinuteSnapshot: GENESIS_GAME_MINUTE,
      voteEpoch: null,
    });
  }
  await repairGenesisGameYear(roomId, GENESIS_GAME_YEAR);
  genesisReadyRooms.add(roomId);
}

/**
 * Idempotent async seed of 3 genesis chronicle rows per room.
 * Skips when countGenesisEntries(roomId) >= 3.
 */
export async function seedWorldHistoryIfNeeded(roomId: string): Promise<void> {
  let inflight = seedInflight.get(roomId);
  if (!inflight) {
    inflight = seedWorldHistoryInner(roomId).finally(() => {
      seedInflight.delete(roomId);
    });
    seedInflight.set(roomId, inflight);
  }
  await inflight;
}

/** Test helper — clears in-process genesis seed short-circuit. */
export function clearGenesisSeedCache(): void {
  genesisReadyRooms.clear();
  seedInflight.clear();
}
