import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CouncilDeliberationBanner } from "./CouncilDeliberationBanner.js";
import { CouncilDeliberationChip } from "./CouncilDeliberationChip.js";
import { CouncilDeliberationFeed } from "./CouncilDeliberationFeed.js";
import { CouncilDeliberationProgress } from "./CouncilDeliberationProgress.js";
import { councilVoteToastTitle } from "./CouncilVoteToast.js";

describe("CouncilDeliberationChip", () => {
  it("renders chip testid and truncated title", () => {
    const html = renderToStaticMarkup(
      createElement(CouncilDeliberationChip, {
        proposalTitle: "这是一段超过二十四个汉字的议会提案标题需要截断显示",
        onOpenCouncil: () => {},
      }),
    );
    expect(html).toContain('data-testid="council-deliberation-chip"');
    expect(html).toContain("议会审议中");
    expect(html).toContain("…");
  });
});

describe("CouncilDeliberationBanner", () => {
  it("renders epoch variant copy", () => {
    const html = renderToStaticMarkup(
      createElement(CouncilDeliberationBanner, { voteKind: "epoch" }),
    );
    expect(html).toContain('data-testid="council-deliberation-banner"');
    expect(html).toContain("council-deliberation-banner--epoch");
    expect(html).toContain("纪元大议");
  });
});

describe("CouncilDeliberationProgress", () => {
  it("renders round and phase labels", () => {
    const html = renderToStaticMarkup(
      createElement(CouncilDeliberationProgress, {
        round: 1,
        roundTotal: 2,
        phase: "debate",
      }),
    );
    expect(html).toContain('data-testid="council-deliberation-progress"');
    expect(html).toContain("第 1/2 轮辩论");
    expect(html).toContain("辩论");
  });
});

describe("CouncilDeliberationFeed", () => {
  it("renders quote row", () => {
    const html = renderToStaticMarkup(
      createElement(CouncilDeliberationFeed, {
        rows: [
          {
            kind: "quote",
            npcId: "npc-1",
            displayName: "莫玄虚",
            text: "廷议须慎。",
          },
        ],
      }),
    );
    expect(html).toContain('data-testid="council-deliberation-feed"');
    expect(html).toContain("莫玄虚");
  });
});

describe("CouncilVoteToast", () => {
  it("exposes accepted toast copy", () => {
    expect(
      councilVoteToastTitle({
        kind: "vote_accepted",
        title: "测试案",
        yesCount: 7,
        noCount: 4,
        resultEntryId: "wh-1",
      }),
    ).toBe("廷议通过");
  });
});
