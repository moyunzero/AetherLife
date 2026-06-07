import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  bandFromEffectiveScore,
  computeEffectiveScore,
  personalitySeedForNpc,
  type AttitudeBand,
} from "@aetherlife/shared";
import { playerApiHeaders } from "../lib/playerSession.js";

const apiBase = import.meta.env.VITE_GAME_SERVER_URL || "/api";

export type CollectiveEventSummary = {
  id: string;
  kind: string;
  summary: string;
  deltaScore: number;
  createdAt: string;
  npcId?: string;
  source?: string;
};

export type CollectiveAttitudeSnapshot = {
  npcId: string;
  band: AttitudeBand;
  effectiveScore: number;
  playerReputation: number;
  collectiveWindowMean: number;
  recentEvents: CollectiveEventSummary[];
};

type AttitudeRow = {
  npcId: string;
  band: AttitudeBand;
  effectiveScore: number;
  reputation: number;
  collectiveWindowMean: number;
};

/** Phase 12.1 D-09b: refetch once when worker sets collectiveUpdated on job done. */
export function shouldRefetchCollectiveOnJobDone(collectiveUpdated?: boolean): boolean {
  return collectiveUpdated === true;
}

export function snapshotsFromPayload(
  attitudes: AttitudeRow[],
  events: CollectiveEventSummary[],
): Map<string, CollectiveAttitudeSnapshot> {
  const next = new Map<string, CollectiveAttitudeSnapshot>();
  for (const attitude of attitudes) {
    next.set(attitude.npcId, {
      npcId: attitude.npcId,
      band: attitude.band,
      effectiveScore: attitude.effectiveScore,
      playerReputation: attitude.reputation,
      collectiveWindowMean: attitude.collectiveWindowMean,
      recentEvents: events
        .filter((e) => e.npcId === attitude.npcId)
        .slice(0, 5),
    });
  }
  return next;
}

/** Server default when DB reachable but no events — also used if fetch fails after retries. */
export function baselineCollectiveSnapshots(
  npcIds: readonly string[] = ["npc-1", "npc-2", "npc-3"],
): Map<string, CollectiveAttitudeSnapshot> {
  const rows: AttitudeRow[] = npcIds.map((npcId) => {
    const reputation = personalitySeedForNpc(npcId);
    const effectiveScore = computeEffectiveScore(reputation, []);
    return {
      npcId,
      band: bandFromEffectiveScore(effectiveScore),
      effectiveScore,
      reputation,
      collectiveWindowMean: 0,
    };
  });
  return snapshotsFromPayload(rows, []);
}

export function useCollectiveAttitude(roomId: string, activeNpcId: string) {
  const [cache, setCache] = useState<Map<string, CollectiveAttitudeSnapshot>>(
    () => new Map(),
  );
  const [loading, setLoading] = useState(false);
  const requestSeqRef = useRef(0);
  const cacheRef = useRef(cache);
  cacheRef.current = cache;

  const fetchCollective = useCallback(
    async (opts?: { signal?: AbortSignal; retryUntilMs?: number }) => {
      if (!roomId) return;

      const seq = ++requestSeqRef.current;
      const hadCache = cacheRef.current.size > 0;
      const showSpinner = !hadCache;
      if (showSpinner) setLoading(true);

      const deadline = Date.now() + (opts?.retryUntilMs ?? 0);
      const url = `${apiBase}/rooms/${encodeURIComponent(roomId)}/collective-state`;

      try {
        while (true) {
          try {
            const res = await fetch(url, {
              headers: playerApiHeaders(),
              signal: opts?.signal,
            });
            if (seq !== requestSeqRef.current) return;
            if (res.ok) {
              const body = (await res.json()) as {
                attitudes?: AttitudeRow[];
                recentEvents?: CollectiveEventSummary[];
              };
              if (seq !== requestSeqRef.current) return;
              setCache(
                snapshotsFromPayload(body.attitudes ?? [], body.recentEvents ?? []),
              );
              return;
            }
          } catch (err) {
            if (seq !== requestSeqRef.current) return;
            if (err instanceof DOMException && err.name === "AbortError") return;
          }

          if (Date.now() >= deadline) {
            if (!hadCache) setCache(baselineCollectiveSnapshots());
            return;
          }
          await new Promise((r) => setTimeout(r, 400));
        }
      } finally {
        if (seq === requestSeqRef.current) {
          setLoading(false);
        }
      }
    },
    [roomId],
  );

  useEffect(() => {
    if (!roomId) {
      setCache(new Map());
      return;
    }

    const aborter = new AbortController();
    void fetchCollective({ signal: aborter.signal, retryUntilMs: 15_000 });
    return () => {
      aborter.abort();
    };
  }, [roomId, fetchCollective]);

  const refetchCollective = useCallback(() => {
    void fetchCollective();
  }, [fetchCollective]);

  /** Clear stale band/events immediately (e.g. POST /reset) then refetch. */
  const invalidateCollective = useCallback(() => {
    setCache(new Map());
    void fetchCollective({ retryUntilMs: 15_000 });
  }, [fetchCollective]);

  const snapshot = useMemo(
    () => cache.get(activeNpcId) ?? null,
    [cache, activeNpcId],
  );

  return { snapshot, loading, refetchCollective, invalidateCollective };
}
