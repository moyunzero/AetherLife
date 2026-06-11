import { describe, expect, it, vi } from "vitest";
import { clearAllIntentsForTests } from "./intent-cache.js";
import { applySegmentStartIntentFallback } from "./segment-intent.js";
import { getOrCreate } from "../room/store.js";
import { findNpc } from "@aetherlife/shared";

describe("applySegmentStartIntentFallback", () => {
  it("sets non-empty intentReasonZh on map before async job", () => {
    clearAllIntentsForTests();
    const roomId = "seg-fallback-room";
    const { state: map } = getOrCreate(roomId);
    const segment = {
      zoneId: "beginning-fields@v1:orchard",
      activityKey: "reading",
      mobility: "stationary" as const,
      fromMinute: 360,
      toMinute: 480,
    };

    applySegmentStartIntentFallback(roomId, "npc-1", segment, 360);

    const npc = findNpc(map, "npc-1");
    expect(npc?.intentReasonZh?.trim().length).toBeGreaterThan(0);
  });

  it("calls setIntent before enqueue would run (ordering contract)", () => {
    clearAllIntentsForTests();
    const enqueue = vi.fn();
    const roomId = "seg-order-room";
    const segment = {
      zoneId: "beginning-fields@v1:plaza",
      activityKey: "patrol",
      mobility: "wander" as const,
      fromMinute: 480,
      toMinute: 720,
    };

    applySegmentStartIntentFallback(roomId, "npc-2", segment, 480);
    enqueue("npc-2", "segment_change");

    const { state: map } = getOrCreate(roomId);
    expect(findNpc(map, "npc-2")?.intentReasonZh?.trim()).not.toBe("");
    expect(enqueue).toHaveBeenCalledOnce();
  });
});
