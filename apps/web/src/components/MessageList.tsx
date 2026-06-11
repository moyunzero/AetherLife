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

/**
 * Format a chat message's text for NPC display, prefixing with the NPC's name when present and sanitizing NPC replies.
 *
 * @param message - The chat message; when `message.role` is `"npc"` the function uses `message.npcName` and `message.text` to build the display string
 * @returns The formatted text: `message.text` unchanged for non-NPC roles; for NPC messages, the sanitized `message.text` prefixed with `{npcName}：` when `message.npcName` is present
 */
function formatNpcText(message: ChatMessage): string {
  if (message.role !== "npc") return message.text;
  const prefix = message.npcName ? `${message.npcName}：` : "";
  return `${prefix}${sanitizeNpcReplyText(message.text)}`;
}

/**
 * Prepare a possibly truncated display value for a memory string and provide the full text when truncated.
 *
 * @param text - The memory text to format for display.
 * @param maxLen - Maximum number of characters to show before truncating; defaults to 120.
 * @returns An object with `display` (the original text or a truncated version ending with an ellipsis) and `title` (the full original text) only when truncation occurred.
 */
function formatMemoryDisplay(text: string, maxLen = 120): { display: string; title?: string } {
  if (text.length <= maxLen) return { display: text };
  return { display: `${text.slice(0, maxLen)}…`, title: text };
}

/**
 * Render the chat message list including NPC replies, memory callbacks, and an optional streaming "thinking" indicator.
 *
 * @param messages - Array of chat messages to render in order.
 * @param thinkingNpcId - NPC id that is currently producing a reply, or `null` when none.
 * @param activeNpcId - Id of the currently active NPC; used to decide whether the thinking indicator is shown.
 * @param thinkingNpcName - Display name used when rendering the thinking/streaming UI.
 * @param streamingReply - Optional incremental reply text to display while an NPC reply is streaming; may be `null` or omitted.
 * @returns The rendered message list element.
 */
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
