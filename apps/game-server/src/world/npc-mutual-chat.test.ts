/**
 * Wave 0 stub — Phase 28 NPC mutual chat (D-MUTUAL-01…07, D-VERIFY-01).
 * GREEN fill: plans 05–06 (selector, stagger, speak defer, supersede ambient dyad).
 */
import { describe, it } from "vitest";

describe("npc-mutual-chat (Wave 0)", () => {
  it.skip("D-MUTUAL-01/05: proximity + schedule filter selects eligible pairs (no hard veto by score)", () => {
    // TODO plan 05: selector returns weighted pairs; nemesis may still enqueue
  });

  it.skip("D-MUTUAL-03: daily stagger caps 2–3 pair triggers per game day with 12-seat rotation", () => {
    // TODO plan 05: bucket rotation aligns with Phase 27 weekly stagger pattern
  });

  it.skip("D-MUTUAL-07: defers enqueue when player speak is in-progress (same as world-vote)", () => {
    // TODO plan 05–06: speak-busy defer; no queue push during speak
  });

  it.skip("D-MUTUAL / A2: mutual-chat supersedes ambient dyad for same room/day/pair claim", () => {
    // TODO plan 05: speak-mention dyad path unchanged
  });
});
