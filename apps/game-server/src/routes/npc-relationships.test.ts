/**
 * Wave 0 stub — Phase 28 player-scoped GET npc-relationships (D-API-01…03, D-GRAPH-02).
 * GREEN fill: plan 07 (+ C-09b band DTO from plan 03).
 */
import { describe, it } from "vitest";

describe("npc-relationships routes (Wave 0)", () => {
  it.skip("D-API-01/03: GET /rooms/:roomId/npc-relationships requires joined-room / session scope", () => {
    // TODO plan 07: reject unscoped callers; align with personal-timeline GET auth
  });

  it.skip("D-GRAPH-02 / D-API-01: response maps edges to band labels — no raw affection/trust integers", () => {
    // TODO plan 07: RelationshipEdgeBandPublic shape only
  });

  it.skip("D-API-01: relationshipSync broadcast helper emits { hasUpdate } / seq hint only", () => {
    // TODO plan 07: bodies stay on HTTP GET
  });
});
