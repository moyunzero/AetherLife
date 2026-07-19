import { useCallback, useEffect, useRef, useState } from "react";
import {
  COUNCIL_NPC_IDS,
  type ColyseusPersonalTimelineSyncPayload,
  type PersonalTimelineEntry,
  type PersonalTimelineTag,
} from "@aetherlife/shared";
import { playerApiHeaders } from "../lib/playerSession.js";

const apiBase = import.meta.env.VITE_GAME_SERVER_URL || "/api";

export type BiographyFilter = "all" | "relationship" | "council";

const PREVIEW_MIN = 40;
const PREVIEW_MAX = 45;

export const PERSONAL_TIMELINE_TAG_LABEL_ZH: Record<PersonalTimelineTag, string> = {
  daily: "日常",
  adventure: "冒险",
  emotion: "情绪",
  conflict: "冲突",
  reflection: "反思",
  relationship: "关系",
  council: "议会",
};

export function filterPersonalTimelineEntries(
  entries: PersonalTimelineEntry[],
  filter: BiographyFilter,
): PersonalTimelineEntry[] {
  if (filter === "all") return entries;
  return entries.filter((e) => e.tag === filter);
}

/** D-UI-06: collapsed preview ≈ 40–60 chars + ellipsis. */
export function previewPersonalTimelineBody(
  body: string,
  max = PREVIEW_MAX,
  min = PREVIEW_MIN,
): string {
  if (body.length <= max) return body;
  const cut = Math.min(Math.max(min, max), body.length);
  return `${body.slice(0, cut)}…`;
}

export function maxEntrySeq(entries: PersonalTimelineEntry[]): number {
  let max = 0;
  for (const e of entries) {
    if (e.seq > max) max = e.seq;
  }
  return max;
}

export function shouldShowBiographyHint(
  latestSeq: number | undefined,
  readCursor: number | undefined,
): boolean {
  if (latestSeq == null || !Number.isFinite(latestSeq)) return false;
  const cursor = readCursor ?? 0;
  return latestSeq > cursor;
}

export function clearNpcBiographyHint(
  hasUpdate: Record<string, boolean>,
  npcId: string,
): Record<string, boolean> {
  if (!hasUpdate[npcId]) return hasUpdate;
  return { ...hasUpdate, [npcId]: false };
}

/** D-SYNC-03: restore hints when server latestSeq is ahead of local read cursors. */
export function reconcileHintsFromLatestSeq(
  latestByNpc: Record<string, number>,
  readCursors: Record<string, number>,
): Record<string, boolean> {
  const next: Record<string, boolean> = {};
  for (const [npcId, latestSeq] of Object.entries(latestByNpc)) {
    next[npcId] = shouldShowBiographyHint(latestSeq, readCursors[npcId]);
  }
  return next;
}

/** D-UI-04: biography/REL never enqueue chronicle-style toasts. */
export function personalTimelineSyncToasts(
  _payload: ColyseusPersonalTimelineSyncPayload,
): never[] {
  return [];
}

export function isPersonalTimelineSyncPayload(
  data: unknown,
): data is ColyseusPersonalTimelineSyncPayload {
  if (!data || typeof data !== "object") return false;
  const row = data as Record<string, unknown>;
  if (typeof row.npcId !== "string" || row.npcId.length === 0) return false;
  if (typeof row.hasUpdate !== "boolean") return false;
  if (
    row.latestSeq !== undefined &&
    (typeof row.latestSeq !== "number" || !Number.isFinite(row.latestSeq))
  ) {
    return false;
  }
  return true;
}

type ListResponse = {
  ok?: boolean;
  roomId?: string;
  npcId?: string;
  entries?: PersonalTimelineEntry[];
};

export function usePersonalTimeline(roomId: string, roomConnected = false) {
  const [entriesByNpcId, setEntriesByNpcId] = useState<
    Record<string, PersonalTimelineEntry[]>
  >({});
  const [hasUpdateByNpcId, setHasUpdateByNpcId] = useState<Record<string, boolean>>(
    {},
  );
  const [loadingNpcId, setLoadingNpcId] = useState<string | null>(null);
  const readCursorRef = useRef<Record<string, number>>({});
  const latestSeqRef = useRef<Record<string, number>>({});
  const requestSeqRef = useRef(0);
  /** First connect bootstraps cursors silently; later reconnects restore hints (D-SYNC-03). */
  const hasBootstrappedRef = useRef(false);

  const fetchTimeline = useCallback(
    async (
      npcId: string,
      opts?: { signal?: AbortSignal; limit?: number },
    ): Promise<PersonalTimelineEntry[]> => {
      if (!roomId || !roomConnected || !npcId) return [];
      const params = new URLSearchParams();
      if (opts?.limit != null) params.set("limit", String(opts.limit));
      const qs = params.toString();
      const url = `${apiBase}/rooms/${encodeURIComponent(roomId)}/npcs/${encodeURIComponent(npcId)}/personal-timeline${qs ? `?${qs}` : ""}`;
      const res = await fetch(url, {
        headers: playerApiHeaders(),
        signal: opts?.signal,
      });
      if (!res.ok) {
        throw new Error(`personal-timeline ${res.status}`);
      }
      const body = (await res.json()) as ListResponse;
      if (!body.ok || !Array.isArray(body.entries)) {
        throw new Error("personal-timeline invalid response");
      }
      return body.entries;
    },
    [roomId, roomConnected],
  );

  const openBiography = useCallback(
    async (npcId: string) => {
      if (!roomId || !roomConnected || !npcId) return;
      const seq = ++requestSeqRef.current;
      setLoadingNpcId(npcId);
      try {
        const entries = await fetchTimeline(npcId);
        if (seq !== requestSeqRef.current) return;
        const latest = maxEntrySeq(entries);
        readCursorRef.current[npcId] = latest;
        latestSeqRef.current[npcId] = Math.max(
          latestSeqRef.current[npcId] ?? 0,
          latest,
        );
        setEntriesByNpcId((prev) => ({ ...prev, [npcId]: entries }));
        // Only clear hint after a successful fetch (WR-04).
        setHasUpdateByNpcId((prev) => clearNpcBiographyHint(prev, npcId));
      } catch {
        // Leave hint + read cursor unchanged on failure.
      } finally {
        if (seq === requestSeqRef.current) setLoadingNpcId(null);
      }
    },
    [fetchTimeline, roomId, roomConnected],
  );

  const mergePersonalTimelineSync = useCallback(
    (payload: ColyseusPersonalTimelineSyncPayload) => {
      if (!isPersonalTimelineSyncPayload(payload)) return;
      // Explicit no-toast path (D-UI-04) — keep call for regression tests / symmetry.
      void personalTimelineSyncToasts(payload);

      const { npcId, hasUpdate, latestSeq } = payload;
      if (typeof latestSeq === "number") {
        latestSeqRef.current[npcId] = Math.max(
          latestSeqRef.current[npcId] ?? 0,
          latestSeq,
        );
      }
      const knownLatest = latestSeqRef.current[npcId];
      const show =
        hasUpdate &&
        shouldShowBiographyHint(knownLatest ?? latestSeq ?? Number.POSITIVE_INFINITY, readCursorRef.current[npcId]);
      if (!show) return;
      setHasUpdateByNpcId((prev) =>
        prev[npcId] ? prev : { ...prev, [npcId]: true },
      );
    },
    [],
  );

  const pullLatestSeqs = useCallback(async (): Promise<Record<string, number>> => {
    const aborter = new AbortController();
    const latestByNpc: Record<string, number> = { ...latestSeqRef.current };
    await Promise.all(
      COUNCIL_NPC_IDS.map(async (npcId) => {
        try {
          const entries = await fetchTimeline(npcId, {
            signal: aborter.signal,
            limit: 1,
          });
          const latest = maxEntrySeq(entries);
          if (latest > 0) {
            latestByNpc[npcId] = Math.max(latestByNpc[npcId] ?? 0, latest);
          }
        } catch {
          /* ignore per-npc failures */
        }
      }),
    );
    latestSeqRef.current = { ...latestSeqRef.current, ...latestByNpc };
    return latestByNpc;
  }, [fetchTimeline]);

  const reconcileOnReconnect = useCallback(async () => {
    if (!roomId || !roomConnected) return;
    const latestByNpc = await pullLatestSeqs();
    if (!hasBootstrappedRef.current) {
      hasBootstrappedRef.current = true;
      for (const [npcId, latestSeq] of Object.entries(latestByNpc)) {
        if (readCursorRef.current[npcId] === undefined) {
          readCursorRef.current[npcId] = latestSeq;
        }
      }
      return;
    }
    setHasUpdateByNpcId((prev) => {
      const restored = reconcileHintsFromLatestSeq(
        latestByNpc,
        readCursorRef.current,
      );
      return { ...prev, ...restored };
    });
  }, [pullLatestSeqs, roomId, roomConnected]);

  useEffect(() => {
    if (!roomId) {
      hasBootstrappedRef.current = false;
      readCursorRef.current = {};
      latestSeqRef.current = {};
      setEntriesByNpcId({});
      setHasUpdateByNpcId({});
      return;
    }
    if (!roomConnected) return;
    void reconcileOnReconnect();
  }, [roomId, roomConnected, reconcileOnReconnect]);

  return {
    entriesByNpcId,
    hasUpdateByNpcId,
    loadingNpcId,
    openBiography,
    fetchTimeline,
    mergePersonalTimelineSync,
    reconcileOnReconnect,
  };
}
