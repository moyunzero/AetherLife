import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NpcAvatarStrip } from "./NpcAvatarStrip.js";
import { ShellDrawer } from "./ShellDrawer.js";

const shellDrawerWorldHistoryProps = {
  worldHistoryEntries: [] as import("@aetherlife/shared").WorldHistoryPublicEntry[],
  worldHistoryLoading: false,
  worldHistoryStatusFilter: "accepted" as const,
  onWorldHistoryStatusFilterChange: () => {},
  worldHistoryGameYear: 1,
  worldHistoryGameYearLabel: "太乙纪·元年",
  worldHistoryPage: 1,
  worldHistoryTotalPages: 1,
  worldHistoryAvailableYears: [1],
  onWorldHistoryGameYearChange: () => {},
  onWorldHistoryPageChange: () => {},
  onFetchWorldHistoryEntry: async () => null,
};

describe("NpcAvatarStrip a11y", () => {
  it("uses click activation and dialogue-overlay as aria-controls", () => {
    const html = renderToStaticMarkup(
      createElement(NpcAvatarStrip, {
        npcs: [
          { id: "npc-1", name: "阿明" },
          { id: "npc-2", name: "阿花" },
        ],
        activeNpcId: "npc-1",
        onSelect: () => {},
      }),
    );
    expect(html).toContain('aria-controls="dialogue-overlay"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('tabindex="-1"');
  });
});

describe("ShellDrawer a11y", () => {
  it("places chronicle tab immediately after council tab", () => {
    const html = renderToStaticMarkup(
      createElement(ShellDrawer, {
        open: true,
        tab: "history",
        onTabChange: () => {},
        onClose: () => {},
        messages: [],
        thinkingNpcId: null,
        activeNpcId: "npc-1",
        activeNpcName: "阿明",
        collectiveSnapshot: null,
        collectiveLoading: false,
        discoveredLoreRows: [],
        ...shellDrawerWorldHistoryProps,
        roomId: "room-1",
        roomConnected: true,
      }),
    );
    const tabIds = [...html.matchAll(/id="(shell-drawer-tab-[^"]+)"/g)].map((m) => m[1]);
    const councilPos = tabIds.indexOf("shell-drawer-tab-council");
    const chroniclePos = tabIds.indexOf("shell-drawer-tab-chronicle");
    expect(councilPos).toBeGreaterThanOrEqual(0);
    expect(chroniclePos).toBe(councilPos + 1);
  });

  it("wires drawer tabs to shell-drawer-panel ids", () => {
    const html = renderToStaticMarkup(
      createElement(ShellDrawer, {
        open: true,
        tab: "history",
        onTabChange: () => {},
        onClose: () => {},
        messages: [],
        thinkingNpcId: null,
        activeNpcId: "npc-1",
        activeNpcName: "阿明",
        collectiveSnapshot: null,
        collectiveLoading: false,
        discoveredLoreRows: [],
        ...shellDrawerWorldHistoryProps,
        roomId: "room-1",
        roomConnected: true,
      }),
    );
    expect(html).toContain('id="shell-drawer-tab-history"');
    expect(html).toContain('aria-controls="shell-drawer-panel-history"');
    expect(html).toContain('id="shell-drawer-tab-council"');
    expect(html).toContain("星际议会");
    expect(html).toContain('id="shell-drawer-tab-chronicle"');
    expect(html).toContain("编年史");
    expect(html).toContain('role="tabpanel"');
    expect(html).toContain('id="shell-drawer-panel-history"');
    expect(html).toContain('aria-labelledby="shell-drawer-tab-history"');
    expect(html).not.toContain("npc-avatar-npc-1");
  });

  it("renders council roster when council tab active", () => {
    const html = renderToStaticMarkup(
      createElement(ShellDrawer, {
        open: true,
        tab: "council",
        onTabChange: () => {},
        onClose: () => {},
        messages: [],
        thinkingNpcId: null,
        activeNpcId: "npc-1",
        activeNpcName: "阿明",
        collectiveSnapshot: null,
        collectiveLoading: false,
        discoveredLoreRows: [],
        ...shellDrawerWorldHistoryProps,
        roomId: "room-1",
        roomConnected: true,
      }),
    );
    expect(html).toContain('data-testid="council-roster-panel"');
    expect(html).toContain('id="shell-drawer-panel-council"');
  });

  it("renders world history panel when chronicle tab active", () => {
    const html = renderToStaticMarkup(
      createElement(ShellDrawer, {
        open: true,
        tab: "chronicle",
        onTabChange: () => {},
        onClose: () => {},
        messages: [],
        thinkingNpcId: null,
        activeNpcId: "npc-1",
        activeNpcName: "阿明",
        collectiveSnapshot: null,
        collectiveLoading: false,
        discoveredLoreRows: [],
        ...shellDrawerWorldHistoryProps,
        worldHistoryEntries: [
          {
            id: "wh-1",
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
          },
        ],
        worldHistoryLoading: false,
        roomId: "room-1",
        roomConnected: true,
      }),
    );
    expect(html).toContain('data-testid="world-history-panel"');
    expect(html).toContain('data-testid="world-history-row"');
    expect(html).toContain('id="shell-drawer-panel-chronicle"');
    expect(html).toContain("共署");
  });
});
