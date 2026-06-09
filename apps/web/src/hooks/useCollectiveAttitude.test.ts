import { describe, expect, it } from "vitest";
import {
  baselineCollectiveSnapshots,
  shouldRefetchCollectiveOnJobDone,
  snapshotsFromPayload,
} from "./useCollectiveAttitude.js";

describe("shouldRefetchCollectiveOnJobDone", () => {
  it("refetches only when collectiveUpdated is true", () => {
    expect(shouldRefetchCollectiveOnJobDone(true)).toBe(true);
    expect(shouldRefetchCollectiveOnJobDone(false)).toBe(false);
    expect(shouldRefetchCollectiveOnJobDone(undefined)).toBe(false);
  });
});

describe("snapshotsFromPayload", () => {
  it("maps each npcId and filters recent events per npc", () => {
    const map = snapshotsFromPayload(
      [
        {
          npcId: "npc-1",
          band: "wary",
          effectiveScore: -5,
          reputation: -5,
          collectiveWindowMean: 0,
        },
        {
          npcId: "npc-3",
          band: "neutral",
          effectiveScore: 15,
          reputation: 15,
          collectiveWindowMean: 0,
        },
      ],
      [
        {
          id: "e1",
          npcId: "npc-1",
          kind: "rude",
          summary: "a",
          deltaScore: -8,
          createdAt: "t1",
          playerIds: ["p-a"],
        },
        {
          id: "e2",
          npcId: "npc-3",
          kind: "help",
          summary: "b",
          deltaScore: 6,
          createdAt: "t2",
        },
      ],
    );
    expect(map.get("npc-1")?.band).toBe("wary");
    expect(map.get("npc-3")?.band).toBe("neutral");
    expect(map.get("npc-1")?.recentEvents).toHaveLength(1);
    expect(map.get("npc-3")?.recentEvents[0]?.kind).toBe("help");
  });
});

describe("baselineCollectiveSnapshots", () => {
  it("seeds default npc bands from personality", () => {
    const map = baselineCollectiveSnapshots();
    expect(map.get("npc-1")?.band).toBe("wary");
    expect(map.get("npc-2")?.band).toBe("neutral");
    expect(map.get("npc-3")?.band).toBe("neutral");
    expect(map.get("npc-1")?.playerReputation).toBe(-5);
  });
});
