import { sanitizeNpcReplyText } from "@aetherlife/shared";
import {
  FormEvent,
  KeyboardEvent,
  RefObject,
  useMemo,
} from "react";
import type { ChatMessage } from "../hooks/useNpcChat.js";
import { CollectiveFeedbackBanner } from "./CollectiveFeedbackBanner.js";

export type DrawerTab = "history" | "collective" | "memory";

type Props = {
  draft: string;
  setDraft: (value: string) => void;
  sendMessage: (text: string, npcId: string) => Promise<void>;
  activeNpcId: string;
  activeNpcName: string;
  messages: ChatMessage[];
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
};

function latestNpcReplyFor(
  messages: ChatMessage[],
  activeNpcId: string,
): ChatMessage | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role === "npc" && message.npcId === activeNpcId) {
      return message;
    }
  }
  return null;
}

export function DialogueBar({
  draft,
  setDraft,
  sendMessage,
  activeNpcId,
  activeNpcName,
  messages,
  thinkingNpcId,
  composerBusyForActiveNpc,
  speakBusyNpcId,
  sendingNpcId,
  collectiveFeedbackKind,
  attitudeGateHint,
  roomFull,
  reducedMotion = false,
  composerRef,
  onOpenDrawer,
}: Props) {
  const latestReply = useMemo(
    () => latestNpcReplyFor(messages, activeNpcId),
    [messages, activeNpcId],
  );
  const isThinking = thinkingNpcId === activeNpcId;
  const composerSpeakBusyOtherPlayer =
    speakBusyNpcId === activeNpcId &&
    thinkingNpcId !== activeNpcId &&
    sendingNpcId !== activeNpcId;

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (composerBusyForActiveNpc) return;
    const text = draft;
    if (!text.trim()) return;
    setDraft("");
    await sendMessage(text, activeNpcId);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (composerBusyForActiveNpc || !draft.trim()) return;
      const text = draft;
      setDraft("");
      void sendMessage(text, activeNpcId);
    }
  };

  const composerPlaceholder = composerBusyForActiveNpc
    ? `请等待${activeNpcName}回复…`
    : `你想让${activeNpcName}做什么？`;

  const summaryText = isThinking
    ? "…思考中"
    : latestReply
      ? sanitizeNpcReplyText(latestReply.text)
      : "";

  return (
    <div
      className={`dialogue-bar${reducedMotion ? " dialogue-bar--reduced-motion" : ""}`}
      data-testid="dialogue-bar"
    >
      <div className="dialogue-bar__header">
        <div className="dialogue-bar__summary">
          <span className="dialogue-bar__npc-name">{activeNpcName}</span>
          {summaryText ? (
            <span
              className={`dialogue-bar__summary-text${isThinking ? " dialogue-bar__summary-text--thinking" : ""}`}
              role={isThinking ? "status" : undefined}
            >
              {isThinking ? (
                <>
                  <span className="dialogue-bar__thinking-pulse" aria-hidden="true">
                    …
                  </span>
                  思考中
                </>
              ) : (
                summaryText
              )}
            </span>
          ) : null}
        </div>
        <div className="dialogue-bar__drawer-actions">
          <button
            type="button"
            className="dialogue-bar__drawer-btn"
            aria-label="对话历史"
            onClick={() => onOpenDrawer("history")}
          >
            历史
          </button>
          <button
            type="button"
            className="dialogue-bar__drawer-btn"
            aria-label="集体见闻"
            onClick={() => onOpenDrawer("collective")}
          >
            见闻
          </button>
        </div>
      </div>

      <form className="composer dialogue-bar__composer" onSubmit={onSubmit}>
        {collectiveFeedbackKind ? (
          <CollectiveFeedbackBanner kind={collectiveFeedbackKind} />
        ) : null}
        {attitudeGateHint ? (
          <p
            className="attitude-gate-hint"
            data-testid="attitude-gate-hint"
            role="status"
          >
            {attitudeGateHint}
          </p>
        ) : null}
        {composerBusyForActiveNpc ? (
          <p
            className="composer__speak-status"
            data-testid="composer-speak-status"
            role="status"
          >
            {composerSpeakBusyOtherPlayer
              ? "该 NPC 正在响应其他玩家的指令，请稍候再试。"
              : `${activeNpcName} 正在思考…`}
          </p>
        ) : null}
        <div className="composer__shell dialogue-bar__shell">
          <div className="composer__inner dialogue-bar__inner">
            <textarea
              ref={composerRef}
              className="composer__input dialogue-bar__input"
              rows={2}
              placeholder={composerPlaceholder}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
              disabled={roomFull || composerBusyForActiveNpc}
              aria-busy={composerBusyForActiveNpc}
            />
            <button
              type="submit"
              className="btn btn--primary composer__submit"
              disabled={roomFull || composerBusyForActiveNpc || !draft.trim()}
            >
              发送指令
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
