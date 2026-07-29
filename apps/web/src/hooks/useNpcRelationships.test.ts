/**
 * Phase 28 useNpcRelationships (D-API-01, D-GRAPH-04).
 * GET on tab open + relationshipSync dirty refetch ≤300ms.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RelationshipEdgeBandPublic } from "@aetherlife/shared";
import {
  RELATIONSHIP_SYNC_DEBOUNCE_MS,
  fetchNpcRelationshipEdges,
  isRelationshipSyncPayload,
  mergeRelationshipSync,
  shouldDirtyRefetchRelationships,
  type RelationshipRenderEdge,
} from "./useNpcRelationships.js";

const sampleEdges: RelationshipEdgeBandPublic[] = [
  {
    npcAId: "npc-1",
    npcBId: "npc-2",
    baseTag: "rival",
    band: "hostile",
    bandLabelZh: "敌对",
    kindLabelZh: "宿敌",
    currentStatus: ["紧张"],
  },
];

describe("useNpcRelationships helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("D-GRAPH-04: fetchNpcRelationshipEdges GETs band-mapped edges on open", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, edges: sampleEdges }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const edges = await fetchNpcRelationshipEdges("room-1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("/rooms/room-1/npc-relationships");
    expect(init?.headers).toBeDefined();
    expect(edges).toEqual(sampleEdges);
  });

  it("D-GRAPH-02: render edge type / fetch result omits affection and trust", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        edges: [
          {
            ...sampleEdges[0],
            affection: 42,
            trust: 77,
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const edges = await fetchNpcRelationshipEdges("room-1");
    const edge = edges[0] as RelationshipRenderEdge & {
      affection?: number;
      trust?: number;
    };
    expect(edge).toBeDefined();
    expect("affection" in edge).toBe(false);
    expect("trust" in edge).toBe(false);
    expect(edge.band).toBe("hostile");
    expect(edge.bandLabelZh).toBe("敌对");
  });

  it("isRelationshipSyncPayload accepts hint-only payload", () => {
    expect(isRelationshipSyncPayload({ hasUpdate: true })).toBe(true);
    expect(isRelationshipSyncPayload({ hasUpdate: true, latestSeq: 3 })).toBe(true);
    expect(isRelationshipSyncPayload({ hasUpdate: "yes" })).toBe(false);
    expect(isRelationshipSyncPayload(null)).toBe(false);
  });

  it("D-GRAPH-04: mergeRelationshipSync marks dirty on hasUpdate", () => {
    const next = mergeRelationshipSync(
      { hasUpdate: false, latestSeq: 1 },
      { hasUpdate: true, latestSeq: 4 },
    );
    expect(next.hasUpdate).toBe(true);
    expect(next.latestSeq).toBe(4);
  });

  it("D-GRAPH-04: dirty refetch only when tab focused", () => {
    expect(shouldDirtyRefetchRelationships(true, true)).toBe(true);
    expect(shouldDirtyRefetchRelationships(false, true)).toBe(false);
    expect(shouldDirtyRefetchRelationships(true, false)).toBe(false);
  });

  it("debounce budget is ≤300ms", () => {
    expect(RELATIONSHIP_SYNC_DEBOUNCE_MS).toBeLessThanOrEqual(300);
    expect(RELATIONSHIP_SYNC_DEBOUNCE_MS).toBeGreaterThan(0);
  });
});

describe("relationshipSync dirty refetch schedule", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("D-API-01 / D-GRAPH-04: hasUpdate while focused schedules refetch within debounce", async () => {
    const { scheduleRelationshipDirtyRefetch } = await import("./useNpcRelationships.js");
    const refetch = vi.fn();
    const cancel = scheduleRelationshipDirtyRefetch(true, true, refetch);
    expect(refetch).not.toHaveBeenCalled();
    vi.advanceTimersByTime(RELATIONSHIP_SYNC_DEBOUNCE_MS);
    expect(refetch).toHaveBeenCalledTimes(1);
    cancel?.();
  });

  it("does not schedule refetch when tab is not focused", async () => {
    const { scheduleRelationshipDirtyRefetch } = await import("./useNpcRelationships.js");
    const refetch = vi.fn();
    const cancel = scheduleRelationshipDirtyRefetch(false, true, refetch);
    vi.advanceTimersByTime(RELATIONSHIP_SYNC_DEBOUNCE_MS + 50);
    expect(refetch).not.toHaveBeenCalled();
    expect(cancel).toBeNull();
  });
});
