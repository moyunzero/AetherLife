import { useCallback, useRef, useState } from "react";
import {
  BIOME_LABEL_ZH,
  type BiomeId,
  type ChunkLorePublic,
  type ChunkLoreStatus,
  type ColyseusLoreSyncPayload,
} from "@aetherlife/shared";

export type ChunkLoreEntry = {
  status: ChunkLoreStatus;
  lore?: ChunkLorePublic;
  isFirstDiscover?: boolean;
};

export type LoreDiscoverToast = {
  cx: number;
  cy: number;
  storyHook: string;
};

function chunkKey(cx: number, cy: number): string {
  return `${cx},${cy}`;
}

/** Pending isFirstDiscover + later ready (separate loreSync) → one discover toast (D-06). */
export function loreDiscoverToastsFromSync(
  entries: ColyseusLoreSyncPayload["entries"],
  firstDiscoverPending: Set<string>,
): LoreDiscoverToast[] {
  const toasts: LoreDiscoverToast[] = [];
  for (const entry of entries ?? []) {
    const key = chunkKey(entry.cx, entry.cy);
    if (entry.status === "pending" && entry.isFirstDiscover) {
      firstDiscoverPending.add(key);
    }
    if (
      entry.status === "ready" &&
      entry.lore?.storyHook &&
      (entry.isFirstDiscover || firstDiscoverPending.has(key))
    ) {
      firstDiscoverPending.delete(key);
      toasts.push({ cx: entry.cx, cy: entry.cy, storyHook: entry.lore.storyHook });
    }
  }
  return toasts;
}

export function useChunkLore() {
  const [loreByChunk, setLoreByChunk] = useState<Map<string, ChunkLoreEntry>>(() => new Map());
  const [toastQueue, setToastQueue] = useState<LoreDiscoverToast[]>([]);
  const pendingSinceRef = useRef<Map<string, number>>(new Map());
  const firstDiscoverPendingRef = useRef<Set<string>>(new Set());

  const mergeLoreSync = useCallback((payload: ColyseusLoreSyncPayload) => {
    const toasts = loreDiscoverToastsFromSync(
      payload.entries,
      firstDiscoverPendingRef.current,
    );
    if (toasts.length > 0) {
      setToastQueue((q) => [...q, ...toasts]);
    }
    setLoreByChunk((prev) => {
      const next = new Map(prev);
      for (const entry of payload.entries ?? []) {
        const key = chunkKey(entry.cx, entry.cy);
        if (entry.status === "pending") {
          if (!pendingSinceRef.current.has(key)) {
            pendingSinceRef.current.set(key, Date.now());
          }
        } else {
          pendingSinceRef.current.delete(key);
        }
        next.set(key, {
          status: entry.status,
          lore: entry.lore,
          isFirstDiscover: entry.isFirstDiscover,
        });
      }
      return next;
    });
  }, []);

  const loreForChunk = useCallback(
    (cx: number, cy: number): ChunkLoreEntry | undefined => {
      const entry = loreByChunk.get(chunkKey(cx, cy));
      if (!entry || entry.status !== "pending") return entry;
      const since = pendingSinceRef.current.get(chunkKey(cx, cy));
      if (since && Date.now() - since > 120_000) {
        return { status: "void", lore: entry.lore };
      }
      return entry;
    },
    [loreByChunk],
  );

  const consumeDiscoverToast = useCallback((): LoreDiscoverToast | null => {
    let picked: LoreDiscoverToast | null = null;
    setToastQueue((q) => {
      if (q.length === 0) return q;
      picked = q[0]!;
      return q.slice(1);
    });
    return picked;
  }, []);

  const resetLore = useCallback(() => {
    setLoreByChunk(new Map());
    setToastQueue([]);
    pendingSinceRef.current.clear();
    firstDiscoverPendingRef.current.clear();
  }, []);

  return {
    loreByChunk,
    mergeLoreSync,
    loreForChunk,
    consumeDiscoverToast,
    resetLore,
    toastQueue,
  };
}

export function lorePlaceLabel(
  entry: ChunkLoreEntry | undefined,
  biome: BiomeId | "void",
): { placeName: string; flavor?: string; pending: boolean } {
  if (entry?.status === "home" || (entry?.lore && entry.status === "ready")) {
    return {
      placeName: entry.lore!.nameZh,
      flavor: entry.lore!.flavorOneLine,
      pending: false,
    };
  }
  if (entry?.status === "pending") {
    return {
      placeName: BIOME_LABEL_ZH[biome === "void" ? "meadow" : biome],
      pending: true,
    };
  }
  if (entry?.status === "failed" || entry?.status === "void") {
    return {
      placeName: BIOME_LABEL_ZH[biome === "void" ? "meadow" : biome],
      pending: false,
    };
  }
  return {
    placeName: biome === "void" ? "生成中" : BIOME_LABEL_ZH[biome],
    pending: false,
  };
}
