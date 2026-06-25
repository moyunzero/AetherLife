import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CollectiveAttitudeSnapshot } from "../hooks/useCollectiveAttitude.js";
import { CollectiveBrowsePanel } from "./CollectiveBrowsePanel.js";
import { CollectiveFeedbackBanner } from "./CollectiveFeedbackBanner.js";

const snapshot: CollectiveAttitudeSnapshot = {
  npcId: "npc-1",
  band: "wary",
  effectiveScore: -5,
  playerReputation: -5,
  collectiveWindowMean: 0,
  recentEvents: [
    {
      id: "e1",
      kind: "rude",
      summary: "玩家言语粗鲁",
      deltaScore: -8,
      createdAt: "2026-06-08T12:00:00.000Z",
      playerIds: ["p-a"],
    },
  ],
};

describe("CollectiveBrowsePanel", () => {
  it("renders events list with testids", () => {
    const html = renderToStaticMarkup(
      createElement(CollectiveBrowsePanel, {
        activeNpcName: "路昂",
        snapshot,
        loading: false,
      }),
    );
    expect(html).toContain('data-testid="collective-browse-panel"');
    expect(html).toContain('data-testid="collective-recent-events"');
    expect(html).toContain('data-testid="collective-event-0"');
    expect(html).toContain("路昂 · 小镇见闻");
    expect(html).toContain("冒犯");
    expect(html).not.toContain("effectiveScore");
  });

  it("shows empty copy when no events", () => {
    const html = renderToStaticMarkup(
      createElement(CollectiveBrowsePanel, {
        activeNpcName: "路昂",
        snapshot: { ...snapshot, recentEvents: [] },
      }),
    );
    expect(html).toContain("暂无集体记忆事件");
  });
});

describe("CollectiveFeedbackBanner", () => {
  it("renders rude copy", () => {
    const html = renderToStaticMarkup(
      createElement(CollectiveFeedbackBanner, { kind: "rude" }),
    );
    expect(html).toContain('data-testid="collective-feedback-banner"');
    expect(html).toContain("议论");
  });

  it("renders help copy", () => {
    const html = renderToStaticMarkup(
      createElement(CollectiveFeedbackBanner, { kind: "help" }),
    );
    expect(html).toContain("善意");
  });
});
