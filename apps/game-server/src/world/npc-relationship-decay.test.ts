/**
 * Wave 0 stub — Phase 28 silent idle relationship decay (D-DECAY-01…04, D-VERIFY-02).
 * GREEN fill: plan 04 (applyIdleDecayDeltas + monthly enqueue).
 */
import { describe, it } from "vitest";

describe("npc-relationship-decay (Wave 0)", () => {
  it.skip("D-DECAY-01: idle decay applies deltas with no UI hint / biography / toast", () => {
    // TODO plan 04: silent backend only
  });

  it.skip("D-DECAY-02/03: monthly tick drifts idle edges toward 0 with |Δ| 1–3 and base_tag soft floor/ceiling", () => {
    // TODO plan 04: last_interact_at stale ⇒ decay step
  });

  it.skip("D-DECAY-03: decay does not bump last_interact_at (only real interact sources do)", () => {
    // TODO plan 04: assert timestamp unchanged after idle decay apply
  });

  it.skip("D-DECAY-04: decay runs independent of council in-flight; council counts as recent activity", () => {
    // TODO plan 04: council delta refreshes last_interact_at and skips decay
  });
});
