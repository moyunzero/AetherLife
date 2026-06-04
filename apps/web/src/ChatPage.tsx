import { FormEvent, KeyboardEvent, useEffect, useMemo, useState } from "react";
import { useNpcChat } from "./hooks/useNpcChat.js";
import { MessageList } from "./components/MessageList.js";
import { NpcTabBar } from "./components/NpcTabBar.js";
import { RoomStatePanel } from "./components/RoomStatePanel.js";
import { NpcMemoryPanel } from "./components/NpcMemoryPanel.js";

export function ChatPage() {
  const {
    messages,
    status,
    error,
    roomState,
    activeNpcId,
    setActiveNpcId,
    sendMessage,
    resetGame,
    refetchState,
    lastParsedIntent,
    parseError,
  } = useNpcChat();
  const [draft, setDraft] = useState("");
  const [stateUpdated, setStateUpdated] = useState(false);

  const npcs = useMemo(
    () =>
      (roomState?.npcs ?? []).map((npc) => ({
        id: npc.id,
        name: npc.name,
      })),
    [roomState],
  );

  const activeNpcName =
    npcs.find((npc) => npc.id === activeNpcId)?.name ?? "NPC";

  useEffect(() => {
    void refetchState();
  }, [refetchState]);

  useEffect(() => {
    if (roomState) setStateUpdated(true);
  }, [roomState]);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const text = draft;
    if (!text.trim() || status === "thinking") return;
    setDraft("");
    await sendMessage(text, activeNpcId);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (!draft.trim() || status === "thinking") return;
      const text = draft;
      setDraft("");
      void sendMessage(text, activeNpcId);
    }
  };

  return (
    <div className="chat-page">
      <header className="chat-header">
        <h1 className="chat-header__title">以太人生</h1>
        <button type="button" className="btn btn--destructive" onClick={() => void resetGame()}>
          新游戏
        </button>
      </header>

      {npcs.length > 0 ? (
        <NpcTabBar npcs={npcs} activeNpcId={activeNpcId} onSelect={setActiveNpcId} />
      ) : null}

      <main className="chat-main">
        {error ? <div className="error-banner">{error}</div> : null}
        <MessageList
          messages={messages}
          status={status}
          thinkingNpcName={activeNpcName}
        />
        {roomState ? (
          <RoomStatePanel
            state={roomState}
            activeNpcId={activeNpcId}
            updated={stateUpdated}
          />
        ) : null}
        <NpcMemoryPanel
          roomId="default"
          activeNpcId={activeNpcId}
          activeNpcName={activeNpcName}
          lastParsedIntent={lastParsedIntent}
          parseError={parseError}
        />
      </main>

      <form className="composer" onSubmit={onSubmit}>
        <textarea
          className="composer__input"
          rows={2}
          placeholder={`你想让${activeNpcName}做什么？`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={status === "thinking"}
        />
        <button
          type="submit"
          className="btn btn--primary"
          disabled={status === "thinking" || !draft.trim()}
        >
          发送指令
        </button>
      </form>
    </div>
  );
}
