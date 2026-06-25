import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CouncilRosterPanel } from "./CouncilRosterPanel.js";

describe("CouncilRosterPanel", () => {
  it("renders 12-seat read-only council roster", () => {
    const html = renderToStaticMarkup(createElement(CouncilRosterPanel, {}));
    expect(html).toContain('data-testid="council-roster-panel"');
    expect(html).toContain("莫玄虚");
    expect(html).toContain("海莲娜");
    const rowMatches = html.match(/data-testid="council-roster-row"/g);
    expect(rowMatches).toHaveLength(12);
    expect(html).not.toContain("发送指令");
    expect(html).not.toContain("speak");
    expect(html).not.toContain("composer");
  });
});
