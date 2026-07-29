import { useCallback, useEffect, useRef, useState } from "react";
import {
  type ColyseusRelationshipSyncPayload,
  type RelationshipEdgeBandPublic,
} from "@aetherlife/shared";
import { playerApiHeaders } from "../lib/playerSession.js";

const apiBase = import.meta.env.VITE_GAME_SERVER_URL || "/api";

/** D-GRAPH-04: dirty refetch debounce budget (≤300ms). */
export const RELATIONSHIP_SYNC_DEBOUNCE_MS = 300;

/**
 * Client render type — band-mapped only; never affection/trust (D-GRAPH-02).
 * Alias of RelationshipEdgeBandPublic for UI clarity.
 */
export type RelationshipRenderEdge = Omit<
  RelationshipEdgeBandPublic,
  never
> & {
  affection?: never;
  trust?: never;
};

type ListResponse = {
  ok?: boolean;
  edges?: unknown[];
};

type SyncState = {
  hasUpdate: boolean;
  latestSeq?: number;
};

/** Strip any leaked affection/trust ints before state (T-28-10-LEAK). */
export function toRenderEdge(raw: unknown): RelationshipRenderEdge | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.npcAId !== "string" || typeof row.npcBId !== "string") return null;
  if (typeof row.baseTag !== "string") return null;
  if (
    row.band !== "hostile" &&
    row.band !== "cool" &&
    row.band !== "neutral" &&
    row.band !== "warm" &&
    row.band !== "close"
  ) {
    return null;
  }
  if (typeof row.bandLabelZh !== "string" || typeof row.kindLabelZh !== "string") {
    return null;
  }
  if (!Array.isArray(row.currentStatus)) return null;
  const edge: RelationshipRenderEdge = {
    npcAId: row.npcAId,
    npcBId: row.npcBId,
    baseTag: row.baseTag,
    band: row.band,
    bandLabelZh: row.bandLabelZh,
    kindLabelZh: row.kindLabelZh,
    currentStatus: row.currentStatus.filter((s): s is string => typeof s === "string"),
  };
  return edge;
}

export function isRelationshipSyncPayload(
  data: unknown,
): data is ColyseusRelationshipSyncPayload {
  if (!data || typeof data !== "object") return false;
  const row = data as Record<string, unknown>;
  if (typeof row.hasUpdate !== "boolean") return false;
  if (
    row.latestSeq !== undefined &&
    (typeof row.latestSeq !== "number" || !Number.isFinite(row.latestSeq))
  ) {
    return false;
  }
  return true;
}

export function mergeRelationshipSync(
  prev: SyncState,
  payload: ColyseusRelationshipSyncPayload,
): SyncState {
  const latestSeq =
    typeof payload.latestSeq === "number"
      ? Math.max(prev.latestSeq ?? 0, payload.latestSeq)
      : prev.latestSeq;
  return {
    hasUpdate: prev.hasUpdate || payload.hasUpdate,
    latestSeq,
  };
}

export function shouldDirtyRefetchRelationships(
  tabFocused: boolean,
  hasUpdate: boolean,
): boolean {
  return tabFocused && hasUpdate;
}

/**
 * Schedule a debounced refetch when tab is focused and dirty.
 * Returns cancel fn, or null when no schedule.
 */
export function scheduleRelationshipDirtyRefetch(
  tabFocused: boolean,
  hasUpdate: boolean,
  refetch: () => void,
  debounceMs = RELATIONSHIP_SYNC_DEBOUNCE_MS,
): (() => void) | null {
  if (!shouldDirtyRefetchRelationships(tabFocused, hasUpdate)) return null;
  const id = setTimeout(() => {
    refetch();
  }, debounceMs);
  return () => clearTimeout(id);
}

export async function fetchNpcRelationshipEdges(
  roomId: string,
  opts?: { signal?: AbortSignal },
): Promise<RelationshipRenderEdge[]> {
  if (!roomId) return [];
  const url = `${apiBase}/rooms/${encodeURIComponent(roomId)}/npc-relationships`;
  const res = await fetch(url, {
    headers: playerApiHeaders(),
    signal: opts?.signal,
  });
  if (!res.ok) {
    throw new Error(`npc-relationships ${res.status}`);
  }
  const body = (await res.json()) as ListResponse;
  if (!body.ok || !Array.isArray(body.edges)) {
    throw new Error("npc-relationships invalid response");
  }
  const edges: RelationshipRenderEdge[] = [];
  for (const raw of body.edges) {
    const edge = toRenderEdge(raw);
    if (edge) edges.push(edge);
  }
  return edges;
}

export function useNpcRelationships(
  roomId: string,
  roomConnected = false,
  tabFocused = false,
) {
  const [edges, setEdges] = useState<RelationshipRenderEdge[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasUpdate, setHasUpdate] = useState(false);
  const latestSeqRef = useRef<number | undefined>(undefined);
  const requestSeqRef = useRef(0);
  const loadedOnceRef = useRef(false);
  const edgesRef = useRef<RelationshipRenderEdge[]>([]);
  edgesRef.current = edges;

  const applyFetched = useCallback((next: RelationshipRenderEdge[]) => {
    setEdges(next);
    setError(null);
    setHasUpdate(false);
    loadedOnceRef.current = true;
  }, []);

  const load = useCallback(
    async (opts?: { signal?: AbortSignal }) => {
      if (!roomId || !roomConnected) return;
      const seq = ++requestSeqRef.current;
      setLoading(true);
      try {
        const next = await fetchNpcRelationshipEdges(roomId, opts);
        if (requestSeqRef.current !== seq) return;
        applyFetched(next);
      } catch (err) {
        if (requestSeqRef.current !== seq) return;
        if (opts?.signal?.aborted) return;
        const message =
          err instanceof Error && err.message
            ? err.message
            : "关系网暂时无法载入。请稍后重试，或确认已连上房间。";
        setError(message);
      } finally {
        if (requestSeqRef.current === seq) {
          setLoading(false);
        }
      }
    },
    [applyFetched, roomId, roomConnected],
  );

  /** Tab open → GET (D-GRAPH-04). */
  useEffect(() => {
    if (!tabFocused || !roomId || !roomConnected) return;
    const ac = new AbortController();
    void load({ signal: ac.signal });
    return () => ac.abort();
  }, [tabFocused, roomId, roomConnected, load]);

  /** Dirty while focused → debounced refetch. */
  useEffect(() => {
    if (!shouldDirtyRefetchRelationships(tabFocused, hasUpdate)) return;
    const cancel = scheduleRelationshipDirtyRefetch(tabFocused, hasUpdate, () => {
      void load();
    });
    return () => {
      cancel?.();
    };
  }, [tabFocused, hasUpdate, load]);

  useEffect(() => {
    if (roomId) return;
    requestSeqRef.current = 0;
    loadedOnceRef.current = false;
    latestSeqRef.current = undefined;
    setEdges([]);
    setHasUpdate(false);
    setError(null);
    setLoading(false);
  }, [roomId]);

  const mergeRelationshipSyncCb = useCallback(
    (payload: ColyseusRelationshipSyncPayload) => {
      if (!isRelationshipSyncPayload(payload)) return;
      setHasUpdate((prev) => {
        const next = mergeRelationshipSync(
          { hasUpdate: prev, latestSeq: latestSeqRef.current },
          payload,
        );
        if (typeof next.latestSeq === "number") {
          latestSeqRef.current = next.latestSeq;
        }
        return next.hasUpdate;
      });
    },
    [],
  );

  const clearHasUpdate = useCallback(() => {
    setHasUpdate(false);
  }, []);

  return {
    edges,
    loading,
    error,
    hasUpdate,
    loadedOnce: loadedOnceRef.current,
    load,
    mergeRelationshipSync: mergeRelationshipSyncCb,
    clearHasUpdate,
  };
}
