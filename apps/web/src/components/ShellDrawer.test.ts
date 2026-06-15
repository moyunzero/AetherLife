import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NpcAvatarStrip } from "./NpcAvatarStrip.js";
import { ShellDrawer } from "./ShellDrawer.js";

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
        roomId: "room-1",
        roomConnected: true,
      }),
    );
    expect(html).toContain('id="shell-drawer-tab-history"');
    expect(html).toContain('aria-controls="shell-drawer-panel-history"');
    expect(html).toContain('role="tabpanel"');
    expect(html).toContain('id="shell-drawer-panel-history"');
    expect(html).toContain('aria-labelledby="shell-drawer-tab-history"');
    expect(html).not.toContain("npc-avatar-npc-1");
  });
});
