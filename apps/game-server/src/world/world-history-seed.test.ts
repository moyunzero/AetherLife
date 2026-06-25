import { beforeEach, describe, expect, it } from "vitest";
import {
  AETHER_NEXUS_LORE,
  COUNCIL_NPC_IDS,
  getPersona,
} from "@aetherlife/shared";
import {
  clearWorldHistoryMemory,
  countGenesisEntries,
  getWorldHistoryEntry,
  listWorldHistory,
} from "./world-history-repository.js";
import { clearGenesisSeedCache, seedWorldHistoryIfNeeded } from "./world-history-seed.js";

const GENESIS_TITLES = ["万界崩裂纪", "始源区辟", "十二议会驻"] as const;

describe("seedWorldHistoryIfNeeded", () => {
  beforeEach(() => {
    delete process.env.DATABASE_URL;
    clearWorldHistoryMemory();
    clearGenesisSeedCache();
  });

  it("inserts exactly 3 genesis rows from AETHER_NEXUS_LORE", async () => {
    await seedWorldHistoryIfNeeded("room-genesis");

    expect(await countGenesisEntries("room-genesis")).toBe(3);
    const { entries } = await listWorldHistory({
      roomId: "room-genesis",
      status: "all",
    });
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.title).sort()).toEqual([...GENESIS_TITLES].sort());

    const byTitle = new Map(entries.map((e) => [e.title, e]));
    const row1 = byTitle.get("万界崩裂纪")!;
    const row2 = byTitle.get("始源区辟")!;
    const row3 = byTitle.get("十二议会驻")!;

    const detail1 = (await getWorldHistoryEntry("room-genesis", row1.id))!;
    const detail2 = (await getWorldHistoryEntry("room-genesis", row2.id))!;
    const detail3 = (await getWorldHistoryEntry("room-genesis", row3.id))!;

    expect(detail1.minutes.kind).toBe("genesis_signatories");
    expect(detail1.minutes.proposalFull).toBe(AETHER_NEXUS_LORE.origin);
    expect(detail2.minutes.proposalFull).toBe(AETHER_NEXUS_LORE.beginningFieldsRole);
    expect(detail3.minutes.proposalFull).toBe(AETHER_NEXUS_LORE.historyEvolution);

    for (const entry of entries) {
      expect(entry).not.toHaveProperty("minutes");
      expect(entry.entryKind).toBe("genesis");
      expect(entry.status).toBe("accepted");
      expect(entry.proposerDisplayName).toBe("议会共识");
      expect(entry.gameYear).toBe(1);
      expect(entry.gameYearLabel).toBe("太乙纪·元年");
      expect(entry.yesCount).toBeNull();
      expect(entry.noCount).toBeNull();
      expect(entry.tallyLabel).toBeNull();

      const detail = await getWorldHistoryEntry("room-genesis", entry.id);
      expect(detail?.minutes.kind).toBe("genesis_signatories");
      expect(detail?.minutes.footnote).toBe("此条为奠基文献，非本届廷议表决。");
      expect(detail?.minutes.signatories).toHaveLength(12);
    }
  });

  it("builds 12 signatories from council registry", async () => {
    await seedWorldHistoryIfNeeded("room-signatories");
    const { entries } = await listWorldHistory({
      roomId: "room-signatories",
      status: "all",
    });
    const minutes = (await getWorldHistoryEntry("room-signatories", entries[0]!.id))!.minutes;
    expect(minutes.kind).toBe("genesis_signatories");

    for (let i = 0; i < COUNCIL_NPC_IDS.length; i++) {
      const npcId = COUNCIL_NPC_IDS[i]!;
      const persona = getPersona(npcId);
      const sig = minutes.signatories[i]!;
      expect(sig.npcId).toBe(npcId);
      expect(sig.displayName).toBe(persona.displayName);
      expect(sig.faction).toBe(persona.faction);
      if (persona.stanceManifestoShort) {
        expect(sig.stanceManifestoShort).toBe(persona.stanceManifestoShort);
      }
    }
  });

  it("skips when countGenesisEntries >= 3", async () => {
    await seedWorldHistoryIfNeeded("room-idempotent");
    await seedWorldHistoryIfNeeded("room-idempotent");

    expect(await countGenesisEntries("room-idempotent")).toBe(3);
    const { entries } = await listWorldHistory({
      roomId: "room-idempotent",
      status: "all",
    });
    expect(entries).toHaveLength(3);
  });
});
