import type { ChatMessage } from "../hooks/useNpcChat.js";
import type { CollectiveAttitudeSnapshot } from "../hooks/useCollectiveAttitude.js";
import { CollectiveBrowsePanel } from "./CollectiveBrowsePanel.js";
import { MessageList } from "./MessageList.js";
import { NpcMemoryPanel } from "./NpcMemoryPanel.js";
import type { DrawerTab } from "./DialogueBar.js";

type ParsedIntent = Record<string, unknown> | null;

type Props = {
  open: boolean;
  tab: DrawerTab;
  onTabChange: (tab: DrawerTab) => void;
  onClose: () => void;
  messages: ChatMessage[];
  thinkingNpcId: string | null;
  activeNpcId: string;
  activeNpcName: string;
  streamingReply?: string | null;
  collectiveSnapshot: CollectiveAttitudeSnapshot | null;
  collectiveLoading: boolean;
  roomId: string;
  roomConnected: boolean;
  lastParsedIntent?: ParsedIntent;
  parseError?: string | null;
};

const TABS: { id: DrawerTab; label: string }[] = [
  { id: "history", label: "对话历史" },
  { id: "collective", label: "集体见闻" },
  { id: "memory", label: "记忆" },
];

export function ShellDrawer({
  open,
  tab,
  onTabChange,
  onClose,
  messages,
  thinkingNpcId,
  activeNpcId,
  activeNpcName,
  streamingReply = null,
  collectiveSnapshot,
  collectiveLoading,
  roomId,
  roomConnected,
  lastParsedIntent = null,
  parseError = null,
}: Props) {
  if (!open) return null;

  return (
    <div
      className="shell-drawer-backdrop"
      role="presentation"
      data-testid="shell-drawer-backdrop"
      onClick={onClose}
    >
      <aside
        className="shell-drawer"
        data-testid="shell-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="对话与见闻"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shell-drawer__header">
          <div className="shell-drawer__tabs" role="tablist" aria-label="抽屉标签">
            {TABS.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={tab === item.id}
                className={`shell-drawer__tab${tab === item.id ? " shell-drawer__tab--active" : ""}`}
                onClick={() => onTabChange(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="shell-drawer__close"
            aria-label="关闭抽屉"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="shell-drawer__body">
          {tab === "history" ? (
            <div
              role="tabpanel"
              id={`npc-panel-${activeNpcId}`}
              aria-labelledby={`npc-avatar-${activeNpcId}`}
            >
              <MessageList
                messages={messages}
                thinkingNpcId={thinkingNpcId}
                activeNpcId={activeNpcId}
                thinkingNpcName={activeNpcName}
                streamingReply={streamingReply}
              />
            </div>
          ) : null}

          {tab === "collective" ? (
            <CollectiveBrowsePanel
              activeNpcName={activeNpcName}
              snapshot={collectiveSnapshot}
              loading={collectiveLoading}
              embedded
            />
          ) : null}

          {tab === "memory" ? (
            <NpcMemoryPanel
              roomId={roomId}
              activeNpcId={activeNpcId}
              activeNpcName={activeNpcName}
              roomConnected={roomConnected}
              lastParsedIntent={lastParsedIntent}
              parseError={parseError}
            />
          ) : null}
        </div>
      </aside>
    </div>
  );
}
