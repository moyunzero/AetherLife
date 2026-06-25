import { describe, expect, it } from "vitest";
import type { WorldHistoryPublicEntry } from "@aetherlife/shared";
import {
  mergeEntryIntoPageState,
  shouldMergeEntryIntoVisibleList,
  worldHistoryListCacheKey,
  worldHistorySyncToasts,
} from "./useWorldHistory.js";

function genesisEntry(overrides: Partial<WorldHistoryPublicEntry> = {}): WorldHistoryPublicEntry {
  return {
    id: "wh-genesis-1",
    sequence: 1,
    entryKind: "genesis",
    status: "accepted",
    title: "万界崩裂纪",
    proposalExcerpt: "昔有万界…",
    proposerDisplayName: "议会共识",
    gameYear: 1,
    gameYearLabel: "太乙纪·元年",
    yesCount: null,
    noCount: null,
    tallyLabel: null,
    createdAt: "2026-06-25T00:00:00.000Z",
    minutes: {
      kind: "genesis_signatories",
      proposalFull: "昔有万界…",
      signatories: [],
      footnote: "此条为奠基文献，非本届廷议表决。",
    },
    ...overrides,
  };
}

const emptyPageState = {
  entries: [] as WorldHistoryPublicEntry[],
  gameYear: 1,
  gameYearLabel: "太乙纪·元年",
  page: 1,
  pageSize: 6,
  totalPages: 1,
  availableYears: [1],
};

describe("shouldMergeEntryIntoVisibleList", () => {
  it("accepts entry matching filter and game year", () => {
    const entry = genesisEntry();
    expect(shouldMergeEntryIntoVisibleList(entry, "accepted", emptyPageState)).toBe(true);
  });

  it("rejects entry when status filter mismatches", () => {
    const entry = genesisEntry({ status: "rejected" });
    expect(shouldMergeEntryIntoVisibleList(entry, "accepted", emptyPageState)).toBe(false);
  });

  it("rejects entry when game year mismatches", () => {
    const entry = genesisEntry({ gameYear: 2, gameYearLabel: "太乙纪·2年" });
    expect(shouldMergeEntryIntoVisibleList(entry, "accepted", emptyPageState)).toBe(false);
  });

  it("rejects entry without id", () => {
    const entry = genesisEntry({ id: "" });
    expect(shouldMergeEntryIntoVisibleList(entry, "accepted", emptyPageState)).toBe(false);
  });
});

describe("mergeEntryIntoPageState", () => {
  it("dedupes by entry id", () => {
    const entry = genesisEntry();
    const first = mergeEntryIntoPageState(emptyPageState, entry, { statusFilter: "accepted" });
    const second = mergeEntryIntoPageState(first.next, entry, { statusFilter: "accepted" });
    expect(second.isNew).toBe(false);
    expect(second.next.entries).toHaveLength(1);
  });

  it("prepends visible entry without changing page or gameYear", () => {
    const entry = genesisEntry({ id: "wh-new", title: "新条目" });
    const { next, inserted } = mergeEntryIntoPageState(emptyPageState, entry, {
      statusFilter: "accepted",
    });
    expect(inserted).toBe(true);
    expect(next.entries[0]?.id).toBe("wh-new");
    expect(next.page).toBe(1);
    expect(next.gameYear).toBe(1);
  });

  it("does not insert when filter/year mismatch but marks as new", () => {
    const entry = genesisEntry({ id: "wh-other-year", gameYear: 3, gameYearLabel: "太乙纪·3年" });
    const { next, isNew, inserted } = mergeEntryIntoPageState(emptyPageState, entry, {
      statusFilter: "accepted",
    });
    expect(isNew).toBe(true);
    expect(inserted).toBe(false);
    expect(next.entries).toHaveLength(0);
    expect(next.page).toBe(1);
    expect(next.gameYear).toBe(1);
    expect(next.availableYears).toContain(3);
  });
});

describe("worldHistoryListCacheKey", () => {
  it("includes room, filter, year, page, and page size", () => {
    expect(
      worldHistoryListCacheKey(
        "room-a",
        { statusFilter: "rejected", gameYear: 2, page: 3 },
        6,
      ),
    ).toBe("room-a:rejected:2:3:6");
  });
});

describe("worldHistorySyncToasts", () => {
  it("queues new_entry toast with title", () => {
    const entry = genesisEntry({ id: "wh-toast", title: "始源区辟" });
    const toasts = worldHistorySyncToasts(entry, new Set());
    expect(toasts).toEqual([{ kind: "new_entry", title: "始源区辟" }]);
  });

  it("skips toast when entry id missing or duplicate", () => {
    expect(worldHistorySyncToasts(genesisEntry({ id: "" }), new Set())).toEqual([]);
    const seen = new Set(["wh-genesis-1"]);
    expect(worldHistorySyncToasts(genesisEntry(), seen)).toEqual([]);
  });
});
