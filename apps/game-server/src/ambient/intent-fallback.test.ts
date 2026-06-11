import { describe, expect, it } from "vitest";
import { activityDisplayZh } from "@aetherlife/shared";
import { pickIntentFallbackReasonZh } from "./intent-fallback.js";

describe("pickIntentFallbackReasonZh", () => {
  it("returns motivation text not equal to activityDisplayZh", () => {
    const reason = pickIntentFallbackReasonZh(
      "npc-1",
      "beginning-fields@v1:orchard",
      "reading",
      "stationary",
    );
    expect(reason.length).toBeGreaterThanOrEqual(4);
    expect(reason.length).toBeLessThanOrEqual(18);
    expect(reason).not.toBe(activityDisplayZh("reading"));
    expect(reason).not.toContain("看书");
  });

  it("provides at least 6 distinct strings across npc × zones", () => {
    const combos: Array<[string, string, string]> = [
      ["npc-1", "beginning-fields@v1:orchard", "reading"],
      ["npc-1", "beginning-fields@v1:plaza", "socializing"],
      ["npc-2", "beginning-fields@v1:orchard", "patrol"],
      ["npc-2", "beginning-fields@v1:plaza", "socializing"],
      ["npc-3", "beginning-fields@v1:orchard", "reading"],
      ["npc-3", "beginning-fields@v1:plaza", "patrol"],
    ];
    const distinct = new Set(
      combos.map(([npcId, zoneId, activityKey]) =>
        pickIntentFallbackReasonZh(npcId, zoneId, activityKey, "wander"),
      ),
    );
    expect(distinct.size).toBeGreaterThanOrEqual(6);
  });

  it("varies voice by npcId for same zone", () => {
    const zone = "beginning-fields@v1:plaza";
    const a = pickIntentFallbackReasonZh("npc-1", zone, "patrol", "wander");
    const b = pickIntentFallbackReasonZh("npc-2", zone, "patrol", "wander");
    const c = pickIntentFallbackReasonZh("npc-3", zone, "patrol", "wander");
    expect(new Set([a, b, c]).size).toBeGreaterThanOrEqual(2);
  });
});
