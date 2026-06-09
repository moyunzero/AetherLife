import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { JournalQuestStrip } from "./JournalQuestStrip.js";

describe("JournalQuestStrip", () => {
  it("renders nothing when storyHook is empty", () => {
    const html = renderToStaticMarkup(createElement(JournalQuestStrip, { storyHook: "" }));
    expect(html).toBe("");
  });

  it("shows label and hook with testids when storyHook provided", () => {
    const html = renderToStaticMarkup(
      createElement(JournalQuestStrip, { storyHook: "  旧井边有低语  " }),
    );
    expect(html).toContain('data-testid="journal-quest-strip"');
    expect(html).toContain('data-testid="journal-quest-hook"');
    expect(html).toContain("当前线索");
    expect(html).toContain("旧井边有低语");
    expect(html).toContain('aria-live="polite"');
  });
});
