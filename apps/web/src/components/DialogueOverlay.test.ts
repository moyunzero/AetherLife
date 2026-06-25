import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DialogueOverlay } from "./DialogueOverlay.js";

const baseProps = {
  engaged: true,
  draft: "",
  setDraft: () => {},
  sendMessage: async () => {},
  activeNpcId: "npc-1",
  activeNpcName: "阿明",
  messages: [],
  thinkingNpcId: "npc-1" as string | null,
  composerBusyForActiveNpc: true,
  speakBusyNpcId: null as string | null,
  sendingNpcId: "npc-1" as string | null,
  collectiveFeedbackKind: null as "rude" | "help" | null,
  attitudeGateHint: null as string | null,
  roomFull: false,
  composerRef: { current: null },
  onOpenDrawer: () => {},
  onEndDialogue: () => {},
};

describe("DialogueOverlay streaming partial", () => {
  it("shows streaming text instead of thinking-only placeholder", () => {
    const html = renderToStaticMarkup(
      createElement(DialogueOverlay, {
        ...baseProps,
        streamingReply: "你好呀，今天想聊点什么？",
      }),
    );
    expect(html).toContain('data-testid="dialogue-overlay-streaming"');
    expect(html).toContain("你好呀，今天想聊点什么？");
    expect(html).not.toContain("dialogue-overlay__thinking");
  });

  it("prefers streaming partial over stale last message while thinking", () => {
    const html = renderToStaticMarkup(
      createElement(DialogueOverlay, {
        ...baseProps,
        streamingReply: "新的回复…",
        messages: [
          {
            id: "m1",
            role: "npc",
            text: "旧回复",
            npcId: "npc-1",
            npcName: "阿明",
          },
        ],
      }),
    );
    expect(html).toContain("新的回复…");
    expect(html).not.toContain("旧回复");
  });

  it("shows thinking when busy without streaming or prior line", () => {
    const html = renderToStaticMarkup(
      createElement(DialogueOverlay, {
        ...baseProps,
        streamingReply: null,
      }),
    );
    expect(html).toContain("dialogue-overlay__thinking");
    expect(html).not.toContain("dialogue-overlay-streaming");
  });

  it("shows memory quote when last npc message recalls player", () => {
    const html = renderToStaticMarkup(
      createElement(DialogueOverlay, {
        ...baseProps,
        thinkingNpcId: null,
        composerBusyForActiveNpc: false,
        sendingNpcId: null,
        messages: [
          {
            id: "m1",
            role: "npc",
            text: "我记得你说过密码的事。",
            npcId: "npc-1",
            npcName: "路昂",
            memoryQuote: "玩家说过暗号是晨曦",
          },
        ],
      }),
    );
    expect(html).toContain('data-testid="dialogue-overlay-memory-ref"');
    expect(html).toContain("记得你曾说过");
    expect(html).toContain("玩家说过暗号是晨曦");
  });
});
