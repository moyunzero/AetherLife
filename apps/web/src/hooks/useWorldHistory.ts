import { useCallback, useEffect, useRef, useState } from "react";
import {
  type ColyseusWorldHistorySyncPayload,
  type WorldHistoryListEntry,
  type WorldHistoryPublicEntry,
  type WorldHistoryStatusFilter,
} from "@aetherlife/shared";
import { playerApiHeaders } from "../lib/playerSession.js";

const apiBase = import.meta.env.VITE_GAME_SERVER_URL || "/api";
const DEFAULT_PAGE_SIZE = 6;

export type WorldHistoryPageState = {
  entries: WorldHistoryListEntry[];
  gameYear: number;
  gameYearLabel: string;
  page: number;
  pageSize: number;
  totalPages: number;
  availableYears: number[];
};

export type ChronicleToast = {
  kind: "new_entry";
  entryId: string;
  title: string;
};

export const CHRONICLE_TOAST_MESSAGE = "新编年条目";

type ListWorldHistoryResponse = {
  ok?: boolean;
  gameYear: number;
  gameYearLabel: string;
  page: number;
  pageSize: number;
  totalPages: number;
  availableYears: number[];
  entries: WorldHistoryListEntry[];
};

type WorldHistoryQuery = {
  statusFilter: WorldHistoryStatusFilter;
  gameYear: number;
  page: number;
};

export function worldHistoryListCacheKey(
  roomId: string,
  query: WorldHistoryQuery,
  pageSize: number,
): string {
  return `${roomId}:${query.statusFilter}:${query.gameYear}:${query.page}:${pageSize}`;
}

export function shouldMergeEntryIntoVisibleList(
  entry: Pick<WorldHistoryPublicEntry, "id" | "status" | "gameYear">,
  statusFilter: WorldHistoryStatusFilter,
  pageState: Pick<WorldHistoryPageState, "gameYear">,
): boolean {
  if (!entry.id) return false;
  if (statusFilter !== "all" && entry.status !== statusFilter) return false;
  if (entry.gameYear !== pageState.gameYear) return false;
  return true;
}

/** Live sync may prepend only on page 1 with room left in the slice. */
export function canPrependSyncEntry(
  pageState: Pick<WorldHistoryPageState, "page" | "entries" | "pageSize">,
): boolean {
  return pageState.page === 1 && pageState.entries.length < pageState.pageSize;
}

export function mergeEntryIntoPageState(
  prev: WorldHistoryPageState,
  entry: WorldHistoryPublicEntry,
  opts: { statusFilter: WorldHistoryStatusFilter },
): { next: WorldHistoryPageState; isNew: boolean; inserted: boolean } {
  const { minutes: _minutes, ...listEntry } = entry;

  if (!entry.id) {
    return { next: prev, isNew: false, inserted: false };
  }
  if (prev.entries.some((row) => row.id === entry.id)) {
    return { next: prev, isNew: false, inserted: false };
  }

  const availableYears = prev.availableYears.includes(entry.gameYear)
    ? prev.availableYears
    : [...prev.availableYears, entry.gameYear].sort((a, b) => b - a);

  const visible = shouldMergeEntryIntoVisibleList(entry, opts.statusFilter, prev);
  if (!visible) {
    return {
      next: { ...prev, availableYears },
      isNew: true,
      inserted: false,
    };
  }

  if (!canPrependSyncEntry(prev)) {
    return {
      next: { ...prev, availableYears },
      isNew: true,
      inserted: false,
    };
  }

  return {
    next: {
      ...prev,
      entries: [listEntry, ...prev.entries],
      availableYears,
    },
    isNew: true,
    inserted: true,
  };
}

export function worldHistorySyncToasts(
  entry: Pick<WorldHistoryPublicEntry, "id" | "title">,
  seenIds: Set<string>,
): ChronicleToast[] {
  if (!entry.id || seenIds.has(entry.id)) return [];
  return [{ kind: "new_entry", entryId: entry.id, title: entry.title }];
}

function emptyPageState(pageSize = DEFAULT_PAGE_SIZE): WorldHistoryPageState {
  return {
    entries: [],
    gameYear: 1,
    gameYearLabel: "太乙纪·元年",
    page: 1,
    pageSize,
    totalPages: 1,
    availableYears: [],
  };
}

function defaultQuery(): WorldHistoryQuery {
  return { statusFilter: "accepted", gameYear: 1, page: 1 };
}

export function useWorldHistory(roomId: string, roomConnected = false) {
  const [pageState, setPageState] = useState<WorldHistoryPageState>(() =>
    emptyPageState(),
  );
  const [statusFilter, setStatusFilterState] = useState<WorldHistoryStatusFilter>("accepted");
  const [loading, setLoading] = useState(false);
  const [toastQueue, setToastQueue] = useState<ChronicleToast[]>([]);
  const requestSeqRef = useRef(0);
  const pageStateRef = useRef(pageState);
  const statusFilterRef = useRef(statusFilter);
  const queryRef = useRef<WorldHistoryQuery>(defaultQuery());
  const seenEntryIdsRef = useRef<Set<string>>(new Set());
  const listCacheRef = useRef(new Map<string, WorldHistoryPageState>());
  const detailCacheRef = useRef(new Map<string, WorldHistoryPublicEntry>());
  pageStateRef.current = pageState;
  statusFilterRef.current = statusFilter;

  const invalidateListCache = useCallback(() => {
    listCacheRef.current.clear();
  }, []);

  const applyCachedListIfPresent = useCallback(
    (key: string): boolean => {
      const cached = listCacheRef.current.get(key);
      if (!cached) return false;
      setPageState(cached);
      return true;
    },
    [],
  );

  const fetchWorldHistory = useCallback(
    async (opts?: {
      signal?: AbortSignal;
      retryUntilMs?: number;
      background?: boolean;
      query?: WorldHistoryQuery;
    }) => {
      if (!roomId || !roomConnected) return;

      const query = opts?.query ?? queryRef.current;
      const pageSize = pageStateRef.current.pageSize;
      const cacheKey = worldHistoryListCacheKey(roomId, query, pageSize);
      const isBackground = opts?.background === true;
      let seq: number | null = null;
      if (!isBackground) {
        seq = ++requestSeqRef.current;
        if (!listCacheRef.current.has(cacheKey)) {
          setLoading(true);
        }
      }

      const deadline = Date.now() + (opts?.retryUntilMs ?? 0);
      const { statusFilter: status, gameYear, page } = query;
      const params = new URLSearchParams({
        status,
        page: String(page),
        pageSize: String(pageSize),
        gameYear: String(gameYear),
      });
      const url = `${apiBase}/rooms/${encodeURIComponent(roomId)}/world-history?${params}`;

      const applyResponse = (body: ListWorldHistoryResponse) => {
        const entries = body.entries ?? [];
        for (const entry of entries) {
          if (entry.id) seenEntryIdsRef.current.add(entry.id);
        }
        const nextState: WorldHistoryPageState = {
          entries,
          gameYear: body.gameYear ?? gameYear,
          gameYearLabel: body.gameYearLabel ?? "太乙纪·元年",
          page: body.page ?? page,
          pageSize: body.pageSize ?? pageSize,
          totalPages: body.totalPages ?? 1,
          availableYears: body.availableYears ?? [],
        };
        listCacheRef.current.set(cacheKey, nextState);
        return nextState;
      };

      const prefetchSiblingFilters = (loadedQuery: WorldHistoryQuery) => {
        const filters: WorldHistoryStatusFilter[] = ["accepted", "rejected", "all"];
        for (const statusFilter of filters) {
          if (statusFilter === loadedQuery.statusFilter) continue;
          const siblingKey = worldHistoryListCacheKey(
            roomId,
            { ...loadedQuery, statusFilter },
            pageSize,
          );
          if (listCacheRef.current.has(siblingKey)) continue;
          void fetchWorldHistory({
            background: true,
            query: { ...loadedQuery, statusFilter },
          });
        }
      };

      try {
        while (true) {
          try {
            const res = await fetch(url, {
              headers: playerApiHeaders(),
              signal: opts?.signal,
            });
            if (!isBackground && seq !== requestSeqRef.current) return;
            if (res.ok) {
              const body = (await res.json()) as ListWorldHistoryResponse;
              if (!isBackground && seq !== requestSeqRef.current) return;
              const nextState = applyResponse(body);
              if (isBackground) return;
              setPageState(nextState);
              prefetchSiblingFilters(query);
              return;
            }
          } catch (err) {
            if (!isBackground && seq !== requestSeqRef.current) return;
            if (err instanceof DOMException && err.name === "AbortError") return;
          }

          if (Date.now() >= deadline) return;
          await new Promise((r) => setTimeout(r, 400));
        }
      } finally {
        if (!isBackground && seq === requestSeqRef.current) {
          setLoading(false);
        }
      }
    },
    [roomId, roomConnected],
  );

  const beginListQuery = useCallback(
    (patch: Partial<WorldHistoryQuery>) => {
      queryRef.current = { ...queryRef.current, ...patch };
      const pageSize = pageStateRef.current.pageSize;
      const cacheKey = worldHistoryListCacheKey(roomId, queryRef.current, pageSize);
      if (applyCachedListIfPresent(cacheKey)) {
        setLoading(false);
        void fetchWorldHistory({ background: true });
      } else {
        setPageState((prev) => ({ ...prev, entries: [] }));
        void fetchWorldHistory();
      }
    },
    [applyCachedListIfPresent, fetchWorldHistory, roomId],
  );

  const setStatusFilter = useCallback(
    (filter: WorldHistoryStatusFilter) => {
      statusFilterRef.current = filter;
      setStatusFilterState(filter);
      beginListQuery({ statusFilter: filter, page: 1 });
    },
    [beginListQuery],
  );

  const setGameYear = useCallback(
    (year: number) => {
      beginListQuery({ gameYear: year, page: 1 });
    },
    [beginListQuery],
  );

  const setPage = useCallback(
    (page: number) => {
      beginListQuery({ page });
    },
    [beginListQuery],
  );

  const fetchWorldHistoryEntry = useCallback(
    async (entryId: string): Promise<WorldHistoryPublicEntry | null> => {
      if (!roomId || !roomConnected || !entryId) return null;
      const cached = detailCacheRef.current.get(entryId);
      if (cached) return cached;

      const res = await fetch(
        `${apiBase}/rooms/${encodeURIComponent(roomId)}/world-history/${encodeURIComponent(entryId)}`,
        { headers: playerApiHeaders() },
      );
      if (!res.ok) return null;
      const body = (await res.json()) as { ok?: boolean; entry?: WorldHistoryPublicEntry };
      if (!body.ok || !body.entry) return null;
      detailCacheRef.current.set(entryId, body.entry);
      return body.entry;
    },
    [roomId, roomConnected],
  );

  useEffect(() => {
    if (!roomId) {
      setPageState(emptyPageState());
      setStatusFilterState("accepted");
      queryRef.current = defaultQuery();
      seenEntryIdsRef.current.clear();
      listCacheRef.current.clear();
      detailCacheRef.current.clear();
      return;
    }
    if (!roomConnected) {
      setPageState(emptyPageState());
      return;
    }

    const aborter = new AbortController();
    void fetchWorldHistory({ signal: aborter.signal, retryUntilMs: 15_000 });
    return () => {
      aborter.abort();
    };
  }, [roomId, roomConnected, fetchWorldHistory]);

  const mergeWorldHistorySync = useCallback(
    (payload: ColyseusWorldHistorySyncPayload) => {
      const entry = payload.entry;
      if (!entry?.id) return;

      detailCacheRef.current.set(entry.id, entry);
      invalidateListCache();

      const toasts = worldHistorySyncToasts(entry, seenEntryIdsRef.current);
      if (toasts.length > 0) {
        seenEntryIdsRef.current.add(entry.id);
        setToastQueue((q) => [...q, ...toasts]);
      }

      let shouldRefetch = false;
      setPageState((prev) => {
        const { next, isNew, inserted } = mergeEntryIntoPageState(prev, entry, {
          statusFilter: statusFilterRef.current,
        });
        if (!isNew) return prev;
        if (
          !inserted &&
          shouldMergeEntryIntoVisibleList(entry, statusFilterRef.current, prev)
        ) {
          shouldRefetch = true;
        }
        return next;
      });
      if (shouldRefetch) {
        void fetchWorldHistory({ background: true });
      }
    },
    [invalidateListCache, fetchWorldHistory],
  );

  const consumeChronicleToast = useCallback((): ChronicleToast | null => {
    let picked: ChronicleToast | null = null;
    setToastQueue((q) => {
      if (q.length === 0) return q;
      picked = q[0]!;
      return q.slice(1);
    });
    return picked;
  }, []);

  const resetWorldHistory = useCallback(() => {
    setPageState(emptyPageState());
    setStatusFilterState("accepted");
    queryRef.current = defaultQuery();
    setToastQueue([]);
    seenEntryIdsRef.current.clear();
    listCacheRef.current.clear();
    detailCacheRef.current.clear();
  }, []);

  return {
    pageState,
    statusFilter,
    setStatusFilter,
    setGameYear,
    setPage,
    loading,
    fetchWorldHistoryEntry,
    mergeWorldHistorySync,
    consumeChronicleToast,
    resetWorldHistory,
    refetchWorldHistory: fetchWorldHistory,
    chronicleToastQueue: toastQueue,
  };
}
