import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DiscoveredLorePanel } from "./DiscoveredLorePanel.js";

describe("DiscoveredLorePanel", () => {
  it("renders empty state", () => {
    const html = renderToStaticMarkup(
      createElement(DiscoveredLorePanel, { rows: [], embedded: true }),
    );
    expect(html).toContain('data-testid="discovered-lore-panel"');
    expect(html).toContain('data-testid="discovered-lore-empty"');
    expect(html).toContain("尚未发现新土地");
  });

  it("renders one discovered row without coordinates", () => {
    const html = renderToStaticMarkup(
      createElement(DiscoveredLorePanel, {
        rows: [{ nameZh: "测试草甸", storyHook: "据说这里有故事。" }],
        embedded: true,
      }),
    );
    expect(html).toContain('data-testid="discovered-lore-row"');
    expect(html).toContain("测试草甸");
    expect(html).toContain("据说这里有故事。");
    expect(html).not.toContain("cx");
    expect(html).not.toContain("cy");
  });
});
