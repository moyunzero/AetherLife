import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PersonalTimelineEntry } from "@aetherlife/shared";
import { CouncilBiographySlot } from "./CouncilBiographySlot.js";
import {
  filterPersonalTimelineEntries,
  previewPersonalTimelineBody,
} from "../hooks/usePersonalTimeline.js";

function entry(
  overrides: Partial<PersonalTimelineEntry> & Pick<PersonalTimelineEntry, "id" | "tag" | "body">,
): PersonalTimelineEntry {
  return {
    roomId: "room-1",
    npcId: "npc-1",
    seq: 1,
    calendarLabel: "太乙元年·春·1月·第1日",
    source: "seed",
    createdAt: "2026-07-19T00:00:00.000Z",
    ...overrides,
  };
}

const longBody =
  "这是一段足够长的第一人称传记正文，用来验证折叠预览会被截断到四十到六十个字符之间，并带上省略号。额外一句确保更长。";

describe("CouncilBiographySlot", () => {
  const entries = [
    entry({ id: "rel-1", tag: "relationship", body: longBody, seq: 3 }),
    entry({ id: "council-1", tag: "council", body: "议会里我投了赞成。", seq: 2 }),
    entry({ id: "daily-1", tag: "daily", body: "今日在村口散步。", seq: 1 }),
  ];

  it("renders filter controls 全部 / 关系 / 议会", () => {
    const html = renderToStaticMarkup(
      createElement(CouncilBiographySlot, { entries, filter: "all" }),
    );
    expect(html).toContain('data-testid="council-biography-panel"');
    expect(html).toContain('data-testid="council-biography-filter-all"');
    expect(html).toContain('data-testid="council-biography-filter-relationship"');
    expect(html).toContain('data-testid="council-biography-filter-council"');
    expect(html).toContain("全部");
    expect(html).toContain("关系");
    expect(html).toContain("议会");
  });

  it("关系 filter shows only relationship rows", () => {
    const filtered = filterPersonalTimelineEntries(entries, "relationship");
    const html = renderToStaticMarkup(
      createElement(CouncilBiographySlot, {
        entries,
        filter: "relationship",
      }),
    );
    expect(filtered).toHaveLength(1);
    expect(html).toContain("rel-1");
    expect(html).not.toContain("council-1");
    expect(html).not.toContain("daily-1");
  });

  it("议会 filter shows only council rows", () => {
    const html = renderToStaticMarkup(
      createElement(CouncilBiographySlot, {
        entries,
        filter: "council",
      }),
    );
    expect(html).toContain("council-1");
    expect(html).not.toContain("rel-1");
  });

  it("collapsed preview is 40–60 chars with ellipsis; other tags as badges", () => {
    const preview = previewPersonalTimelineBody(longBody);
    const html = renderToStaticMarkup(
      createElement(CouncilBiographySlot, { entries, filter: "all" }),
    );
    expect(preview.endsWith("…")).toBe(true);
    const core = preview.slice(0, -1);
    expect(core.length).toBeGreaterThanOrEqual(40);
    expect(core.length).toBeLessThanOrEqual(60);
    expect(html).toContain(preview);
    expect(html).toContain('data-testid="council-biography-tag-badge"');
    expect(html).toContain("日常");
  });

  it("expanded row shows full body", () => {
    const html = renderToStaticMarkup(
      createElement(CouncilBiographySlot, {
        entries,
        filter: "relationship",
        expandedId: "rel-1",
      }),
    );
    expect(html).toContain(longBody);
  });
});
