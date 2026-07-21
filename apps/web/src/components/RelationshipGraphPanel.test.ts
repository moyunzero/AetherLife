import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { RelationshipRenderEdge } from "../hooks/useNpcRelationships.js";
import {
  RelationshipGraphPanel,
  graphNodeLabel,
  relationshipGraphToggleCopy,
  resolveDefaultCenterNpcId,
  toggleRelationshipGraphMode,
} from "./RelationshipGraphPanel.js";

/** Fixture includes server-side affection 42 — must never appear in DOM (D-GRAPH-02). */
const fixtureEdges: RelationshipRenderEdge[] = [
  {
    npcAId: "npc-1",
    npcBId: "npc-2",
    baseTag: "rival",
    band: "hostile",
    bandLabelZh: "敌对",
    kindLabelZh: "宿敌",
    currentStatus: ["紧张"],
  },
  {
    npcAId: "npc-1",
    npcBId: "npc-3",
    baseTag: "ally",
    band: "close",
    bandLabelZh: "亲密",
    kindLabelZh: "同盟",
    currentStatus: [],
  },
];

const baseProps = {
  edges: fixtureEdges,
  loading: false,
  error: null as string | null,
  activeNpcId: "npc-1",
  lastRosterNpcId: "npc-2",
  graphMode: "ego" as const,
  centerNpcId: "npc-1",
  onCenterChange: () => {},
  onModeChange: () => {},
};

describe("RelationshipGraphPanel helpers", () => {
  it("D-DRAWER-03: default center prefers activeNpcId, then roster, else npc-1", () => {
    expect(resolveDefaultCenterNpcId("npc-5", "npc-2")).toBe("npc-5");
    expect(resolveDefaultCenterNpcId("", "npc-2")).toBe("npc-2");
    expect(resolveDefaultCenterNpcId(undefined, undefined)).toBe("npc-1");
  });

  it("D-GRAPH-03: toggle copy switches ego ↔ full", () => {
    expect(relationshipGraphToggleCopy("ego")).toBe("查看全图");
    expect(relationshipGraphToggleCopy("full")).toBe("以某人为中心");
    expect(toggleRelationshipGraphMode("ego")).toBe("full");
    expect(toggleRelationshipGraphMode("full")).toBe("ego");
  });

  it("graph node label truncates to ≤4 chars", () => {
    expect(graphNodeLabel("莫玄虚")).toBe("莫玄虚");
    expect(graphNodeLabel("海莲娜·星")).toBe("海莲娜·…");
  });
});

describe("RelationshipGraphPanel", () => {
  it("D-GRAPH-01: renders relationship-graph-panel testid", () => {
    const html = renderToStaticMarkup(createElement(RelationshipGraphPanel, baseProps));
    expect(html).toContain('data-testid="relationship-graph-panel"');
    expect(html).toContain("关系网");
  });

  it("D-GRAPH-02: shows band chips with ZH labels — no raw affection/trust in DOM", () => {
    const html = renderToStaticMarkup(createElement(RelationshipGraphPanel, baseProps));
    expect(html).toContain('data-testid="relationship-graph-band-chip"');
    expect(html).toContain("敌对");
    expect(html).toContain("亲密");
    expect(html).not.toContain("affection");
    expect(html).not.toContain("trust");
    expect(html).not.toMatch(/\b42\b/);
    expect(html).not.toMatch(/\b77\b/);
  });

  it("D-GRAPH-03: ego mode shows center subtitle and mode toggle", () => {
    const html = renderToStaticMarkup(createElement(RelationshipGraphPanel, baseProps));
    expect(html).toContain('data-testid="relationship-graph-mode-toggle"');
    expect(html).toContain("以「莫玄虚」为中心");
    expect(html).toContain("查看全图");
  });

  it("D-GRAPH-03: full mode renders 12-node circle layout marker", () => {
    const html = renderToStaticMarkup(
      createElement(RelationshipGraphPanel, {
        ...baseProps,
        graphMode: "full",
        centerNpcId: "npc-1",
      }),
    );
    expect(html).toContain('data-testid="relationship-graph-mode-full"');
    expect(html).toContain("以某人为中心");
  });

  it("shows loading and error testids", () => {
    const loadingHtml = renderToStaticMarkup(
      createElement(RelationshipGraphPanel, { ...baseProps, loading: true, edges: [] }),
    );
    expect(loadingHtml).toContain('data-testid="relationship-graph-loading"');
    expect(loadingHtml).toContain("载入中");

    const errorHtml = renderToStaticMarkup(
      createElement(RelationshipGraphPanel, {
        ...baseProps,
        error: "关系网暂时无法载入。请稍后重试，或确认已连上房间。",
        edges: [],
      }),
    );
    expect(errorHtml).toContain('data-testid="relationship-graph-error"');
  });
});
