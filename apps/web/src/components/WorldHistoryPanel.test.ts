import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { WorldHistoryListEntry, WorldHistoryPublicEntry } from "@aetherlife/shared";
import { toWorldHistoryListEntry } from "@aetherlife/shared";
import { WorldHistoryPanel } from "./WorldHistoryPanel.js";

const genesisSignatories = Array.from({ length: 12 }, (_, i) => ({
  npcId: `npc-${i + 1}`,
  displayName: `议员${i + 1}`,
  faction: "测试派系",
  stanceManifestoShort: "立场摘要",
}));

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
      signatories: genesisSignatories,
      footnote: "此条为奠基文献，非本届廷议表决。",
    },
    ...overrides,
  };
}

function voteEntry(overrides: Partial<WorldHistoryPublicEntry> = {}): WorldHistoryPublicEntry {
  return {
    id: "wh-vote-1",
    sequence: 4,
    entryKind: "vote",
    status: "accepted",
    title: "扩建农田议案",
    proposalExcerpt: "提议扩建…",
    proposerDisplayName: "阿明",
    gameYear: 2,
    gameYearLabel: "太乙纪·2年",
    yesCount: 8,
    noCount: 3,
    tallyLabel: "8–3",
    createdAt: "2026-06-26T00:00:00.000Z",
    minutes: {
      kind: "vote_minutes",
      proposalFull: "提议扩建始源区农田。",
      ballots: Array.from({ length: 11 }, (_, i) => ({
        npcId: `npc-${i + 2}`,
        displayName: `议员${i + 1}`,
        vote: (i < 8 ? "yes" : "no") as "yes" | "no",
        reasonZh: `理由${i + 1}`,
      })),
    },
    ...overrides,
  };
}

const baseProps = {
  entries: [] as WorldHistoryListEntry[],
  loading: false,
  statusFilter: "accepted" as const,
  onStatusFilterChange: () => {},
  gameYear: 1,
  gameYearLabel: "太乙纪·元年",
  page: 1,
  totalPages: 1,
  availableYears: [1],
  onGameYearChange: () => {},
  onPageChange: () => {},
  onFetchEntryDetail: async () => null,
};

describe("WorldHistoryPanel filter", () => {
  it("renders segmented filter labels with 已采纳 active by default", () => {
    const html = renderToStaticMarkup(
      createElement(WorldHistoryPanel, { ...baseProps, statusFilter: "accepted" }),
    );
    expect(html).toContain('data-testid="world-history-filter"');
    expect(html).toContain("已采纳");
    expect(html).toContain("未采纳");
    expect(html).toContain("全部");
    expect(html).toContain('data-testid="world-history-filter-accepted"');
    expect(html).toContain('aria-pressed="true"');
  });

  it("shows rejected empty state copy", () => {
    const html = renderToStaticMarkup(
      createElement(WorldHistoryPanel, {
        ...baseProps,
        statusFilter: "rejected",
        entries: [],
      }),
    );
    expect(html).toContain('data-testid="world-history-rejected-empty"');
    expect(html).toContain("尚无被否决的提案");
  });
});

describe("WorldHistoryPanel cards", () => {
  it("shows 共署 badge on genesis entry without tally", () => {
    const html = renderToStaticMarkup(
      createElement(WorldHistoryPanel, {
        ...baseProps,
        entries: [toWorldHistoryListEntry(genesisEntry())],
      }),
    );
    expect(html).toContain('data-testid="world-history-cosign-badge"');
    expect(html).toContain("共署");
    expect(html).toContain("万界崩裂纪");
    expect(html).toContain("议会共识");
  });

  it("shows tally on vote entry", () => {
    const html = renderToStaticMarkup(
      createElement(WorldHistoryPanel, {
        ...baseProps,
        entries: [toWorldHistoryListEntry(voteEntry())],
      }),
    );
    expect(html).toContain('data-testid="world-history-tally"');
    expect(html).toContain("8–3");
    expect(html).toContain("阿明");
  });

  it("renders rejected card with muted style and 未采纳 badge", () => {
    const html = renderToStaticMarkup(
      createElement(WorldHistoryPanel, {
        ...baseProps,
        statusFilter: "rejected",
        entries: [toWorldHistoryListEntry(voteEntry({ status: "rejected", id: "wh-rej-1" }))],
      }),
    );
    expect(html).toContain("world-history-panel__row--rejected");
    expect(html).toContain('data-testid="world-history-rejected-badge"');
    expect(html).toContain("未采纳");
  });
});

describe("WorldHistoryPanel volume pagination", () => {
  it("shows game year label and pagination controls", () => {
    const html = renderToStaticMarkup(
      createElement(WorldHistoryPanel, {
        ...baseProps,
        gameYearLabel: "太乙纪·2年",
        gameYear: 2,
        availableYears: [2, 1],
        page: 1,
        totalPages: 3,
      }),
    );
    expect(html).toContain('data-testid="world-history-volume"');
    expect(html).toContain("太乙纪·2年");
    expect(html).toContain('data-testid="world-history-page-footer"');
    expect(html).toContain('data-testid="world-history-page-prev"');
    expect(html).toContain('data-testid="world-history-page-next"');
  });
});
