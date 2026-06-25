import { sanitizeNpcReplyText } from "@aetherlife/shared";
import {
  FormEvent,
  KeyboardEvent,
  RefObject,
} from "react";
import { CollectiveFeedbackBanner } from "./CollectiveFeedbackBanner.js";

export type DrawerTab =
  | "history"
  | "collective"
  | "council"
  | "chronicle"
  | "discoveries"
  | "memory";

type Props = {
  draft: string;
  setDraft: (value: string) => void;
  sendMessage: (text: string, npcId: string) => Promise<void>;
  activeNpcId: string;
  activeNpcName: string;
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

export function DialogueBar({
  draft,
  setDraft,
  sendMessage,
  activeNpcId,
  activeNpcName,
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

  return (
    <div
      className={`dialogue-bar dialogue-bar--overlay${reducedMotion ? " dialogue-bar--reduced-motion" : ""}`}
      data-testid="dialogue-bar"
    >
      <div className="dialogue-bar__header">
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
          <button
            type="button"
            className="dialogue-bar__drawer-btn"
            aria-label="星际议会"
            onClick={() => onOpenDrawer("council")}
          >
            议会
          </button>
          <button
            type="button"
            className="dialogue-bar__drawer-btn"
            aria-label="编年史"
            onClick={() => onOpenDrawer("chronicle")}
          >
            编年史
          </button>
          <button
            type="button"
            className="dialogue-bar__drawer-btn"
            aria-label="已发现"
            onClick={() => onOpenDrawer("discoveries")}
          >
            已发现
          </button>
          <button
            type="button"
            className="dialogue-bar__drawer-btn"
            aria-label="NPC 记忆"
            data-testid="dialogue-drawer-memory"
            onClick={() => onOpenDrawer("memory")}
          >
            记忆
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
              rows={1}
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
