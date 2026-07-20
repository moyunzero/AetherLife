import { useState } from "react";
import type { PersonalTimelineEntry } from "@aetherlife/shared";
import {
  filterPersonalTimelineEntries,
  PERSONAL_TIMELINE_TAG_LABEL_ZH,
  previewPersonalTimelineBody,
  type BiographyFilter,
} from "../hooks/usePersonalTimeline.js";

export type CouncilBiographySlotProps = {
  entries: PersonalTimelineEntry[];
  /** Controlled filter (tests); omit for internal state. */
  filter?: BiographyFilter;
  onFilterChange?: (filter: BiographyFilter) => void;
  /** Controlled expanded entry id (tests). */
  expandedId?: string | null;
  onExpandedIdChange?: (id: string | null) => void;
  loading?: boolean;
  /** Fetch failure message — shown instead of empty when set. */
  error?: string | null;
};

const FILTER_OPTIONS: { id: BiographyFilter; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "relationship", label: "关系" },
  { id: "council", label: "议会" },
];

function sortByTimeDesc(entries: PersonalTimelineEntry[]): PersonalTimelineEntry[] {
  return [...entries].sort((a, b) => {
    if (b.seq !== a.seq) return b.seq - a.seq;
    return (b.aetherEpochMinute ?? 0) - (a.aetherEpochMinute ?? 0);
  });
}

/** BIO-08 / D-UI-*: roster-embedded biography list with hybrid expand + MVP filters. */
export function CouncilBiographySlot({
  entries,
  filter: filterProp,
  onFilterChange,
  expandedId: expandedProp,
  onExpandedIdChange,
  loading = false,
  error = null,
}: CouncilBiographySlotProps) {
  const [internalFilter, setInternalFilter] = useState<BiographyFilter>("all");
  const [internalExpanded, setInternalExpanded] = useState<string | null>(null);

  const filter = filterProp ?? internalFilter;
  const expandedId = expandedProp !== undefined ? expandedProp : internalExpanded;

  const setFilter = (next: BiographyFilter) => {
    onFilterChange?.(next);
    if (filterProp === undefined) setInternalFilter(next);
  };

  const setExpanded = (id: string | null) => {
    onExpandedIdChange?.(id);
    if (expandedProp === undefined) setInternalExpanded(id);
  };

  const visible = sortByTimeDesc(filterPersonalTimelineEntries(entries, filter));

  return (
    <section
      className="council-biography-slot"
      data-testid="council-biography-panel"
      aria-label="议员传记"
    >
      <h4 className="council-roster-panel__section-title">传记</h4>

      <div
        className="council-biography-slot__filter"
        role="group"
        aria-label="传记筛选"
        data-testid="council-biography-filter"
      >
        {FILTER_OPTIONS.map((opt) => (
          <button
            key={opt.id}
            type="button"
            className={`shell-drawer__tab council-biography-slot__filter-btn${
              filter === opt.id ? " shell-drawer__tab--active" : ""
            }`}
            data-testid={`council-biography-filter-${opt.id}`}
            aria-pressed={filter === opt.id}
            onClick={() => setFilter(opt.id)}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {loading && entries.length === 0 ? (
        <p className="council-biography-slot__empty" data-testid="council-biography-loading">
          载入中…
        </p>
      ) : null}

      {!loading && error ? (
        <p
          className="council-biography-slot__empty council-biography-slot__error"
          data-testid="council-biography-error"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      {!loading && !error && visible.length === 0 ? (
        <p className="council-biography-slot__empty" data-testid="council-biography-empty">
          尚无传记条目
        </p>
      ) : null}

      {visible.length > 0 ? (
        <ul className="council-biography-slot__list">
          {visible.map((row) => {
            const expanded = expandedId === row.id;
            const preview = previewPersonalTimelineBody(row.body);
            const tagLabel = PERSONAL_TIMELINE_TAG_LABEL_ZH[row.tag] ?? row.tag;
            return (
              <li key={row.id} data-entry-id={row.id}>
                <button
                  type="button"
                  className={`council-biography-slot__row${
                    expanded ? " council-biography-slot__row--expanded" : ""
                  }`}
                  data-testid="council-biography-row"
                  aria-expanded={expanded}
                  onClick={() => setExpanded(expanded ? null : row.id)}
                >
                  <div className="council-biography-slot__meta">
                    <span className="council-biography-slot__calendar">
                      {row.calendarLabel}
                    </span>
                    <span
                      className="council-biography-slot__badge"
                      data-testid="council-biography-tag-badge"
                    >
                      {tagLabel}
                    </span>
                  </div>
                  <p className="council-biography-slot__body">
                    {expanded ? row.body : preview}
                  </p>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
