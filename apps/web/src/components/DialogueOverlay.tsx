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
  onEndDialogue: () => void;
};

function lastNpcLineFor(messages: ChatMessage[], npcId: string): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg?.role === "npc" && msg.npcId === npcId) {
      return msg.text;
    }
  }
  return null;
}

function portraitInitial(name: string): string {
  const trimmed = name.trim();
  return trimmed ? trimmed.slice(0, 1) : "?";
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
  const lastLine = lastNpcLineFor(messages, activeNpcId);
  const partialText = streamingReply?.trim()
    ? sanitizeNpcReplyText(streamingReply)
    : "";
  const displayLine = partialText || lastLine;
  const isStreaming =
    Boolean(partialText) && dialogueBarProps.thinkingNpcId === activeNpcId;
  const showThinkingOnly =
    dialogueBarProps.thinkingNpcId === activeNpcId && !displayLine;

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
            <DialogueBar
              activeNpcId={activeNpcId}
              activeNpcName={activeNpcName}
              messages={messages}
              layout="overlay"
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
