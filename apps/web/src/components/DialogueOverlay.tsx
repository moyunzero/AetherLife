import { sanitizeNpcReplyText } from "@aetherlife/shared";
import type { RefObject } from "react";
import type { ChatMessage } from "../hooks/useNpcChat.js";
import { DialogueBar, type DrawerTab } from "./DialogueBar.js";

type Props = {
  engaged: boolean;
  draft: string;
  setDraft: (value: string) => void;
  sendMessage: (text: string, npcId: string) => Promise<void>;
  activeNpcId: string;
  activeNpcName: string;
  messages: ChatMessage[];
  /** Incremental NPC reply (speakPartial) while job in-flight. */
  streamingReply?: string | null;
  thinkingNpcId: string | null;
  composerBusyForActiveNpc: boolean;
  speakBusyNpcId: string | null;
  sendingNpcId: string | null;
  collectiveFeedbackKind: "rude" | "help" | null;
  attitudeGateHint: string | null;
  roomFull: boolean;
  reducedMotion?: boolean;
  composerRef: RefObject<HTMLTextAreaElement | null>;
  onOpenDrawer: (tab: DrawerTab) => void;
  deliberationActive?: boolean;
  deliberationProposalTitle?: string;
  onEndDialogue: () => void;
};

function lastNpcMessageFor(
  messages: ChatMessage[],
  npcId: string,
): ChatMessage | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg?.role === "npc" && msg.npcId === npcId) {
      return msg;
    }
  }
  return null;
}

function portraitInitial(name: string): string {
  const trimmed = name.trim();
  return trimmed ? trimmed.slice(0, 1) : "?";
}

function formatMemoryDisplay(text: string, maxLen = 100): { display: string; title?: string } {
  if (text.length <= maxLen) return { display: text };
  return { display: `${text.slice(0, maxLen)}…`, title: text };
}

/** Contextual Stardew-style dialogue shell (UI-SPEC-v2-A). DOM input; overlay on world. */
export function DialogueOverlay({
  engaged,
  activeNpcId,
  activeNpcName,
  messages,
  streamingReply = null,
  onEndDialogue,
  ...dialogueBarProps
}: Props) {
  const lastNpc = lastNpcMessageFor(messages, activeNpcId);
  const lastLine = lastNpc?.text ?? null;
  const memoryQuote = lastNpc?.memoryQuote?.trim() ?? "";
  const partialText = streamingReply?.trim()
    ? sanitizeNpcReplyText(streamingReply)
    : "";
  const displayLine = partialText || lastLine;
  const isStreaming =
    Boolean(partialText) && dialogueBarProps.thinkingNpcId === activeNpcId;
  const showThinkingOnly =
    dialogueBarProps.thinkingNpcId === activeNpcId && !displayLine;
  const memoryDisplay = memoryQuote ? formatMemoryDisplay(memoryQuote) : null;

  return (
    <div
      id="dialogue-overlay"
      className={`dialogue-overlay${engaged ? " dialogue-overlay--engaged" : ""}`}
      data-testid="dialogue-overlay"
      data-engaged={engaged ? "true" : "false"}
      aria-hidden={!engaged}
    >
      {engaged ? (
        <div className="dialogue-overlay__frame">
          <div className="dialogue-overlay__portrait" aria-hidden="true">
            <span className="dialogue-overlay__portrait-initial">
              {portraitInitial(activeNpcName)}
            </span>
          </div>
          <div className="dialogue-overlay__body">
            <div className="dialogue-overlay__meta">
              <span className="dialogue-overlay__npc-name">{activeNpcName}</span>
              {showThinkingOnly ? (
                <span className="dialogue-overlay__thinking" role="status">
                  <span className="dialogue-overlay__thinking-pulse" aria-hidden="true">
                    …
                  </span>
                  思考中
                </span>
              ) : null}
            </div>
            {displayLine && !showThinkingOnly ? (
              <p
                className={`dialogue-overlay__last-line${isStreaming ? " dialogue-overlay__last-line--streaming" : ""}`}
                data-testid={isStreaming ? "dialogue-overlay-streaming" : undefined}
                role={isStreaming ? "status" : undefined}
                aria-live={isStreaming ? "polite" : undefined}
              >
                {displayLine}
              </p>
            ) : null}
            {memoryDisplay && !isStreaming ? (
              <blockquote
                className="dialogue-overlay__memory-ref"
                data-testid="dialogue-overlay-memory-ref"
                title={memoryDisplay.title}
              >
                <span className="dialogue-overlay__memory-ref-label">记得你曾说过</span>
                <p>{memoryDisplay.display}</p>
              </blockquote>
            ) : null}
            <DialogueBar
              activeNpcId={activeNpcId}
              activeNpcName={activeNpcName}
              {...dialogueBarProps}
            />
            <button
              type="button"
              className="dialogue-overlay__end-btn"
              data-testid="dialogue-end"
              onClick={onEndDialogue}
            >
              结束对话
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
