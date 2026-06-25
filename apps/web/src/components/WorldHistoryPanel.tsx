import { useState } from "react";
import type {
  WorldHistoryListEntry,
  WorldHistoryPublicEntry,
  WorldHistoryStatusFilter,
} from "@aetherlife/shared";
import { WorldHistoryMinutesModal } from "./WorldHistoryMinutesModal.js";

type Props = {
  entries: WorldHistoryListEntry[];
  loading?: boolean;
  statusFilter: WorldHistoryStatusFilter;
  onStatusFilterChange: (filter: WorldHistoryStatusFilter) => void;
  gameYear: number;
  gameYearLabel: string;
  page: number;
  totalPages: number;
  availableYears: number[];
  onGameYearChange: (year: number) => void;
  onPageChange: (page: number) => void;
  onFetchEntryDetail: (entryId: string) => Promise<WorldHistoryPublicEntry | null>;
};

const FILTER_OPTIONS: { id: WorldHistoryStatusFilter; label: string }[] = [
  { id: "accepted", label: "已采纳" },
  { id: "rejected", label: "未采纳" },
  { id: "all", label: "全部" },
];

function sortedYearsDesc(years: number[]): number[] {
  return [...years].sort((a, b) => b - a);
}

export function WorldHistoryPanel({
  entries,
  loading = false,
  statusFilter,
  onStatusFilterChange,
  gameYear,
  gameYearLabel,
  page,
  totalPages,
  availableYears,
  onGameYearChange,
  onPageChange,
  onFetchEntryDetail,
}: Props) {
  const [selectedEntry, setSelectedEntry] = useState<WorldHistoryPublicEntry | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const yearsDesc = sortedYearsDesc(availableYears.length > 0 ? availableYears : [gameYear]);
  const yearIndex = yearsDesc.indexOf(gameYear);
  const canPrevYear = yearIndex >= 0 && yearIndex < yearsDesc.length - 1;
  const canNextYear = yearIndex > 0;
  const canPrevPage = page > 1;
  const canNextPage = page < totalPages;

  const emptyCopy =
    statusFilter === "rejected" ? "尚无被否决的提案" : "尚无编年条目";

  return (
    <div
      className="world-history-panel world-history-panel--embedded"
      data-testid="world-history-panel"
    >
      <h3 className="world-history-panel__title">编年史</h3>

      <div
        className="world-history-panel__filter"
        role="group"
        aria-label="编年史筛选"
        data-testid="world-history-filter"
      >
        {FILTER_OPTIONS.map((opt) => (
          <button
            key={opt.id}
            type="button"
            className={`shell-drawer__tab world-history-panel__filter-btn${
              statusFilter === opt.id ? " shell-drawer__tab--active" : ""
            }`}
            data-testid={`world-history-filter-${opt.id}`}
            aria-pressed={statusFilter === opt.id}
            onClick={() => onStatusFilterChange(opt.id)}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <div className="world-history-panel__volume" data-testid="world-history-volume">
        <button
          type="button"
          className="world-history-panel__volume-btn"
          data-testid="world-history-year-prev"
          disabled={!canPrevYear}
          aria-label="上一卷"
          onClick={() => {
            if (canPrevYear) onGameYearChange(yearsDesc[yearIndex + 1]!);
          }}
        >
          ‹
        </button>
        <span className="world-history-panel__volume-label">{gameYearLabel}</span>
        <button
          type="button"
          className="world-history-panel__volume-btn"
          data-testid="world-history-year-next"
          disabled={!canNextYear}
          aria-label="下一卷"
          onClick={() => {
            if (canNextYear) onGameYearChange(yearsDesc[yearIndex - 1]!);
          }}
        >
          ›
        </button>
      </div>

      {loading && entries.length === 0 ? (
        <p className="world-history-panel__empty" data-testid="world-history-loading">
          载入中…
        </p>
      ) : null}

      {!loading && entries.length === 0 ? (
        <p
          className="world-history-panel__empty"
          data-testid={
            statusFilter === "rejected"
              ? "world-history-rejected-empty"
              : "world-history-empty"
          }
        >
          {emptyCopy}
        </p>
      ) : null}

      {entries.length > 0 ? (
        <ul className="world-history-panel__list">
          {entries.map((entry) => {
            const isRejected = entry.status === "rejected";
            const showCosign =
              entry.entryKind === "genesis" || entry.tallyLabel == null;
            return (
              <li key={entry.id}>
                <button
                  type="button"
                  className={`world-history-panel__row${
                    isRejected ? " world-history-panel__row--rejected" : ""
                  }`}
                  data-testid="world-history-row"
                  onClick={() => {
                    void (async () => {
                      setDetailLoading(true);
                      try {
                        const full = await onFetchEntryDetail(entry.id);
                        if (full) setSelectedEntry(full);
                      } finally {
                        setDetailLoading(false);
                      }
                    })();
                  }}
                >
                  <p className="world-history-panel__card-title">{entry.title}</p>
                  <div className="world-history-panel__meta">
                    <span className="world-history-panel__proposer">
                      {entry.proposerDisplayName}
                    </span>
                    {showCosign ? (
                      <span
                        className="world-history-panel__badge"
                        data-testid="world-history-cosign-badge"
                      >
                        共署
                      </span>
                    ) : (
                      <span
                        className="world-history-panel__tally"
                        data-testid="world-history-tally"
                      >
                        {entry.tallyLabel}
                      </span>
                    )}
                    {isRejected ? (
                      <span
                        className="world-history-panel__badge world-history-panel__badge--rejected"
                        data-testid="world-history-rejected-badge"
                      >
                        未采纳
                      </span>
                    ) : null}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      <footer
        className="world-history-panel__page-footer"
        data-testid="world-history-page-footer"
      >
        <span className="world-history-panel__page-volume">{gameYearLabel}</span>
        <div className="world-history-panel__page-nav">
          <button
            type="button"
            className="world-history-panel__page-btn"
            data-testid="world-history-page-prev"
            disabled={!canPrevPage}
            aria-label="上一页"
            onClick={() => onPageChange(page - 1)}
          >
            上一页
          </button>
          <span className="world-history-panel__page-indicator">
            {page} / {totalPages}
          </span>
          <button
            type="button"
            className="world-history-panel__page-btn"
            data-testid="world-history-page-next"
            disabled={!canNextPage}
            aria-label="下一页"
            onClick={() => onPageChange(page + 1)}
          >
            下一页
          </button>
        </div>
      </footer>

      {detailLoading ? (
        <p className="world-history-panel__empty" data-testid="world-history-detail-loading">
          载入纪要…
        </p>
      ) : null}

      {selectedEntry ? (
        <WorldHistoryMinutesModal
          entry={selectedEntry}
          onClose={() => setSelectedEntry(null)}
        />
      ) : null}
    </div>
  );
}
