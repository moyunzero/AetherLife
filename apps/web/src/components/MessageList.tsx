import type { ChatMessage, ChatStatus } from "../hooks/useNpcChat.js";

type Props = {
  messages: ChatMessage[];
  status: ChatStatus;
  thinkingNpcName: string;
};

function formatNpcText(message: ChatMessage): string {
  if (message.role !== "npc") return message.text;
  const prefix = message.npcName ? `${message.npcName}：` : "";
  return `${prefix}${message.text}`;
}

export function MessageList({ messages, status, thinkingNpcName }: Props) {
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
          </article>
        );
      })}
      {status === "thinking" && (
        <article className="message message--thinking" aria-live="polite">
          <span className="thinking-bar" aria-hidden="true" />
          <p className="message__text">{thinkingNpcName}正在思考…</p>
        </article>
      )}
    </div>
  );
}
