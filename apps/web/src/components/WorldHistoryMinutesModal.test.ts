import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { WorldHistoryPublicEntry } from "@aetherlife/shared";
import { WorldHistoryMinutesModal } from "./WorldHistoryMinutesModal.js";

const genesisSignatories = Array.from({ length: 12 }, (_, i) => ({
  npcId: `npc-${i + 1}`,
  displayName: `议员${i + 1}`,
  faction: "测试派系",
  stanceManifestoShort: "立场摘要",
}));

function genesisEntry(): WorldHistoryPublicEntry {
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
      proposalFull: "昔有万界崩裂，始源区辟。",
      signatories: genesisSignatories,
      footnote: "此条为奠基文献，非本届廷议表决。",
    },
  };
}

describe("WorldHistoryMinutesModal genesis", () => {
  it("shows 太乙志 · 史前纪 title and 12 signatory cards", () => {
    const html = renderToStaticMarkup(
      createElement(WorldHistoryMinutesModal, {
        entry: genesisEntry(),
        onClose: () => {},
      }),
    );
    expect(html).toContain('data-testid="world-history-minutes-modal"');
    expect(html).toContain('data-testid="world-history-minutes-title"');
    expect(html).toContain("太乙志 · 史前纪");
    expect(html).not.toContain("廷议实录");
    const signatoryCards = html.match(/data-testid="world-history-signatory-card"/g);
    expect(signatoryCards).toHaveLength(12);
    expect(html).toContain("此条为奠基文献，非本届廷议表决。");
    expect(html).not.toContain("赞成");
    expect(html).not.toContain("反对");
  });
});

describe("WorldHistoryMinutesModal vote", () => {
  it("shows 廷议实录 title and ballot cards", () => {
    const entry: WorldHistoryPublicEntry = {
      ...genesisEntry(),
      entryKind: "vote",
      minutes: {
        kind: "vote_minutes",
        proposalFull: "提议扩建农田。",
        ballots: Array.from({ length: 11 }, (_, i) => ({
          npcId: `npc-${i + 2}`,
          displayName: `议员${i + 2}`,
          vote: (i < 6 ? "yes" : "no") as "yes" | "no",
          reasonZh: `理由${i + 2}`,
        })),
      },
      proposerDisplayName: "莫玄虚",
    };
    const html = renderToStaticMarkup(
      createElement(WorldHistoryMinutesModal, {
        entry,
        onClose: () => {},
      }),
    );
    expect(html).toContain("廷议实录");
    expect(html).toContain("提案人：莫玄虚（不计票）");
    expect(html).not.toContain("太乙志 · 史前纪");
    const ballotCards = html.match(/data-testid="world-history-ballot-card"/g);
    expect(ballotCards).toHaveLength(11);
    expect(html).toContain("赞成");
    expect(html).toContain("反对");
  });

  it("shows debate excerpts when present", () => {
    const entry: WorldHistoryPublicEntry = {
      ...genesisEntry(),
      entryKind: "vote",
      minutes: {
        kind: "vote_minutes",
        proposalFull: "提议扩建农田。",
        ballots: Array.from({ length: 11 }, (_, i) => ({
          npcId: `npc-${i + 2}`,
          displayName: `议员${i + 2}`,
          vote: (i < 6 ? "yes" : "no") as "yes" | "no",
          reasonZh: `理由${i + 2}`,
        })),
        debateExcerpts: [
          {
            round: 1,
            npcId: "npc-2",
            displayName: "阿斯托利亚",
            fullText: "完整辩论发言内容。",
            feedQuote: "高光一句",
          },
        ],
      },
      proposerDisplayName: "莫玄虚",
    };
    const html = renderToStaticMarkup(
      createElement(WorldHistoryMinutesModal, {
        entry,
        onClose: () => {},
      }),
    );
    expect(html).toContain('data-testid="world-history-minutes-debate-excerpts"');
    expect(html).toContain("辩论摘录");
    expect(html).toContain("完整辩论发言内容。");
    expect(html).toContain("现场高光：高光一句");
  });
});
