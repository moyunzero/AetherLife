import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MessageList } from "./MessageList.js";

describe("MessageList memory citation", () => {
  it("renders npc-memory-callback when message has memoryQuote", () => {
    const html = renderToStaticMarkup(
      createElement(MessageList, {
        messages: [
          {
            id: "m1",
            role: "npc",
            text: "你好。",
            npcId: "npc-1",
            npcName: "阿明",
            memoryQuote: "player: FACT-XYZ-42",
          },
        ],
        thinkingNpcId: null,
        activeNpcId: "npc-1",
        thinkingNpcName: "阿明",
      }),
    );
    expect(html).toContain('data-testid="npc-memory-callback"');
    expect(html).toContain("记得你曾说过");
    expect(html).toContain("FACT-XYZ-42");
  });

  it("omits citation when memoryQuote absent", () => {
    const html = renderToStaticMarkup(
      createElement(MessageList, {
        messages: [{ id: "m1", role: "npc", text: "你好。", npcId: "npc-1" }],
        thinkingNpcId: null,
        activeNpcId: "npc-1",
        thinkingNpcName: "阿明",
      }),
    );
    expect(html).not.toContain("npc-memory-callback");
  });
});
