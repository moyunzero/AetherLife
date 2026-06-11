import { sanitizeNpcReplyText } from "@aetherlife/shared";
import type { ChatMessage } from "../hooks/useNpcChat.js";

type Props = {
  messages: ChatMessage[];
  thinkingNpcId: string | null;
  activeNpcId: string;
  thinkingNpcName: string;
  /** Incremental NPC reply while job in-flight (speakPartial); composer stays disabled. */
  streamingReply?: string | null;
};

function formatNpcText(message: ChatMessage): string {
  if (message.role !== "npc") return message.text;
  const prefix = message.npcName ? `${message.npcName}：` : "";
  return `${prefix}${sanitizeNpcReplyText(message.text)}`;
}

function formatMemoryDisplay(text: string, maxLen = 120): { display: string; title?: string } {
  if (text.length <= maxLen) return { display: text };
  return { display: `${text.slice(0, maxLen)}…`, title: text };
}

export function MessageList({
  messages,
  thinkingNpcId,
  activeNpcId,
  thinkingNpcName,
  streamingReply = null,
}: Props) {
  const showThinking = thinkingNpcId !== null && thinkingNpcId === activeNpcId;
  const partialText = streamingReply?.trim() ?? "";
  return (
    <div className="message-list">
      {messages.length === 0 && (
        <p className="empty-state">输入任意指令，与 NPC 开始对话。</p>
      )}
      {messages.map((message, index) => {
        const isLatestNpc =
          message.role === "npc" && index === messages.length - 1;
        return (
          <article
            key={message.id}
            className={`message message--${message.role}${isLatestNpc ? " message--latest" : ""}`}
          >
            <p className="message__text">{formatNpcText(message)}</p>
            {message.role === "npc" && message.memoryQuote ? (
              (() => {
                const { display, title } = formatMemoryDisplay(message.memoryQuote);
                return (
                  <blockquote
                    className="message__memory-ref"
                    data-testid="npc-memory-callback"
                    title={title}
                  >
                    <span className="message__memory-ref-label">记得你曾说过</span>
                    <p>{display}</p>
                  </blockquote>
                );
              })()
            ) : null}
          </article>
        );
      })}
      {showThinking && (
        <article
          className={`message message--thinking${partialText ? " message--streaming" : ""}`}
          aria-live="polite"
          data-testid={partialText ? "npc-streaming-reply" : "npc-thinking"}
        >
          <span className="thinking-bar" aria-hidden="true" />
          <p className="message__text">
            {partialText
              ? `${thinkingNpcName}：${sanitizeNpcReplyText(partialText)}`
              : `${thinkingNpcName}正在思考…`}
          </p>
        </article>
      )}
    </div>
  );
}
