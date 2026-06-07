import { describe, expect, it } from "vitest";
import { MoveIntentTracker } from "./move-intent-tracker.js";

describe("MoveIntentTracker", () => {
  it("detects contradicting move targets", () => {
    const tracker = new MoveIntentTracker();
    const now = 10_000;
    tracker.record("r1", "npc-1", "p-a", 3, 4, now - 100);
    const hit = tracker.detectContradict("r1", "npc-1", "p-b", 5, 4, now, 5000);
    expect(hit).toEqual({ otherPlayerId: "p-a" });
  });

  it("ignores same target cell", () => {
    const tracker = new MoveIntentTracker();
    const now = 10_000;
    tracker.record("r1", "npc-1", "p-a", 3, 4, now - 100);
    expect(tracker.detectContradict("r1", "npc-1", "p-b", 3, 4, now, 5000)).toBeNull();
  });
});
