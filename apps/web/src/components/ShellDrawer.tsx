import type { KeyboardEvent } from "react";
import type { ChatMessage } from "../hooks/useNpcChat.js";
import type { CollectiveAttitudeSnapshot } from "../hooks/useCollectiveAttitude.js";
import { CollectiveBrowsePanel } from "./CollectiveBrowsePanel.js";
import { CouncilRosterPanel } from "./CouncilRosterPanel.js";
import { DiscoveredLorePanel } from "./DiscoveredLorePanel.js";
import { MessageList } from "./MessageList.js";
import { NpcMemoryPanel } from "./NpcMemoryPanel.js";
import type { DrawerTab } from "./DialogueBar.js";
import type { DiscoveredLoreRow } from "../hooks/useChunkLore.js";
import type {
  CouncilDeliberationFeedRow,
  CouncilDeliberationPhase,
  CouncilDeliberationVoteKind,
  LinkedEdge,
  PersonalTimelineEntry,
  WorldHistoryListEntry,
  WorldHistoryPublicEntry,
  WorldHistoryStatusFilter,
} from "@aetherlife/shared";
import { CouncilDeliberationBanner } from "./CouncilDeliberationBanner.js";
import { CouncilDeliberationFeed } from "./CouncilDeliberationFeed.js";
import { CouncilDeliberationProgress } from "./CouncilDeliberationProgress.js";
import { WorldHistoryPanel } from "./WorldHistoryPanel.js";

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
  discoveredLoreRows: DiscoveredLoreRow[];
  worldHistoryEntries: WorldHistoryListEntry[];
  worldHistoryLoading?: boolean;
  worldHistoryStatusFilter: WorldHistoryStatusFilter;
  onWorldHistoryStatusFilterChange: (filter: WorldHistoryStatusFilter) => void;
  worldHistoryGameYear: number;
  worldHistoryGameYearLabel: string;
  worldHistoryPage: number;
  worldHistoryTotalPages: number;
  worldHistoryAvailableYears: number[];
  onWorldHistoryGameYearChange: (year: number) => void;
  onWorldHistoryPageChange: (page: number) => void;
  onFetchWorldHistoryEntry: (entryId: string) => Promise<WorldHistoryPublicEntry | null>;
  chronicleHasUnread?: boolean;
  deliberationActive?: boolean;
  deliberationVoteKind?: CouncilDeliberationVoteKind;
  deliberationPhase?: CouncilDeliberationPhase;
  deliberationRound?: number;
  deliberationRoundTotal?: number;
  deliberationFeedRows?: CouncilDeliberationFeedRow[];
  councilLinkedEdges?: LinkedEdge[];
  personalTimelineEntriesByNpcId?: Record<string, PersonalTimelineEntry[]>;
  personalTimelineHasUpdate?: Record<string, boolean>;
  personalTimelineLoadingNpcId?: string | null;
  personalTimelineErrorByNpcId?: Record<string, string>;
  onOpenPersonalBiography?: (npcId: string) => void;
  roomId: string;
  roomConnected: boolean;
  lastParsedIntent?: ParsedIntent;
  parseError?: string | null;
};

const TABS: { id: DrawerTab; label: string }[] = [
  { id: "history", label: "对话历史" },
  { id: "collective", label: "集体见闻" },
  { id: "council", label: "星际议会" },
  { id: "chronicle", label: "编年史" },
  { id: "discoveries", label: "已发现" },
  { id: "memory", label: "记忆" },
];

function drawerTabId(id: DrawerTab): string {
  return `shell-drawer-tab-${id}`;
}

function drawerPanelId(id: DrawerTab): string {
  return `shell-drawer-panel-${id}`;
}

function focusDrawerTab(id: DrawerTab): void {
  document.getElementById(drawerTabId(id))?.focus();
}

function handleDrawerTabKeyDown(
  event: KeyboardEvent<HTMLButtonElement>,
  index: number,
  onTabChange: (tab: DrawerTab) => void,
): void {
  const { key } = event;
  if (key === "Enter" || key === " ") {
    event.preventDefault();
    onTabChange(TABS[index].id);
    return;
  }
  if (key !== "ArrowLeft" && key !== "ArrowRight" && key !== "Home" && key !== "End") {
    return;
  }
  event.preventDefault();
  let nextIndex = index;
  if (key === "ArrowLeft") {
    nextIndex = (index - 1 + TABS.length) % TABS.length;
  } else if (key === "ArrowRight") {
    nextIndex = (index + 1) % TABS.length;
  } else if (key === "Home") {
    nextIndex = 0;
  } else {
    nextIndex = TABS.length - 1;
  }
  const nextTab = TABS[nextIndex].id;
  onTabChange(nextTab);
  focusDrawerTab(nextTab);
}

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
  discoveredLoreRows,
  worldHistoryEntries,
  worldHistoryLoading = false,
  worldHistoryStatusFilter,
  onWorldHistoryStatusFilterChange,
  worldHistoryGameYear,
  worldHistoryGameYearLabel,
  worldHistoryPage,
  worldHistoryTotalPages,
  worldHistoryAvailableYears,
  onWorldHistoryGameYearChange,
  onWorldHistoryPageChange,
  onFetchWorldHistoryEntry,
  chronicleHasUnread = false,
  deliberationActive = false,
  deliberationVoteKind = "regular",
  deliberationPhase = "proposal",
  deliberationRound = 0,
  deliberationRoundTotal = 1,
  deliberationFeedRows = [],
  councilLinkedEdges = [],
  personalTimelineEntriesByNpcId = {},
  personalTimelineHasUpdate = {},
  personalTimelineLoadingNpcId = null,
  personalTimelineErrorByNpcId = {},
  onOpenPersonalBiography,
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
            {TABS.map((item, index) => (
              <button
                key={item.id}
                id={drawerTabId(item.id)}
                type="button"
                role="tab"
                aria-selected={tab === item.id}
                aria-controls={drawerPanelId(item.id)}
                tabIndex={tab === item.id ? 0 : -1}
                className={`shell-drawer__tab${tab === item.id ? " shell-drawer__tab--active" : ""}`}
                onClick={() => onTabChange(item.id)}
                onKeyDown={(event) => handleDrawerTabKeyDown(event, index, onTabChange)}
              >
                {item.label}
                {item.id === "chronicle" && chronicleHasUnread ? (
                  <span
                    className="shell-drawer__tab-badge"
                    data-testid="shell-drawer-tab-chronicle-unread"
                    aria-label="编年史有新条目"
                  />
                ) : null}
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

        <div
          className="shell-drawer__body"
          role="tabpanel"
          id={drawerPanelId(tab)}
          aria-labelledby={drawerTabId(tab)}
        >
          {tab === "history" ? (
            <MessageList
              messages={messages}
              thinkingNpcId={thinkingNpcId}
              activeNpcId={activeNpcId}
              thinkingNpcName={activeNpcName}
              streamingReply={streamingReply}
            />
          ) : null}

          {tab === "collective" ? (
            <CollectiveBrowsePanel
              activeNpcName={activeNpcName}
              snapshot={collectiveSnapshot}
              loading={collectiveLoading}
            />
          ) : null}

          {tab === "council" ? (
            <div className="shell-drawer__council-deliberation">
              {deliberationActive ? (
                <>
                  <CouncilDeliberationBanner voteKind={deliberationVoteKind} />
                  <CouncilDeliberationProgress
                    round={deliberationRound}
                    roundTotal={deliberationRoundTotal}
                    phase={deliberationPhase}
                  />
                  <CouncilDeliberationFeed rows={deliberationFeedRows} />
                </>
              ) : null}
              <CouncilRosterPanel
                linkedEdges={councilLinkedEdges}
                entriesByNpcId={personalTimelineEntriesByNpcId}
                hasUpdateByNpcId={personalTimelineHasUpdate}
                loadingNpcId={personalTimelineLoadingNpcId}
                errorByNpcId={personalTimelineErrorByNpcId}
                onOpenBiography={onOpenPersonalBiography}
              />
            </div>
          ) : null}

          {tab === "chronicle" ? (
            <WorldHistoryPanel
              entries={worldHistoryEntries}
              loading={worldHistoryLoading}
              statusFilter={worldHistoryStatusFilter}
              onStatusFilterChange={onWorldHistoryStatusFilterChange}
              gameYear={worldHistoryGameYear}
              gameYearLabel={worldHistoryGameYearLabel}
              page={worldHistoryPage}
              totalPages={worldHistoryTotalPages}
              availableYears={worldHistoryAvailableYears}
              onGameYearChange={onWorldHistoryGameYearChange}
              onPageChange={onWorldHistoryPageChange}
              onFetchEntryDetail={onFetchWorldHistoryEntry}
            />
          ) : null}

          {tab === "discoveries" ? (
            <DiscoveredLorePanel rows={discoveredLoreRows} />
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
