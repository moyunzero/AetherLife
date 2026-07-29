/**
 * Phase 28 NPC mutual chat — selector, stagger, speak defer, supersede ambient dyad.
 * D-MUTUAL-01/03/05/07 · RESEARCH A2.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  clearMockNpcMutualChatJobs,
  clearNpcMutualChatJobClaimsForTest,
  getMockNpcMutualChatJob,
} from "../queue/npc-mutual-chat.js";
import {
  clearNpcMutualChatState,
  isPairClaimedForMutualChat,
  maybeEnqueueNpcMutualChat,
  MUTUAL_CHAT_MAX_PER_DAY,
  shouldDeferNpcMutualChatEnqueue,
} from "./npc-mutual-chat.js";
import {
  clearMockPersonalTimelineJobs,
  clearPersonalTimelineJobClaimsForTest,
} from "../queue/personal-timeline.js";
import {
  clearPersonalTimelineDyadState,
  maybeEnqueueDyadFromAmbient,
} from "./personal-timeline-dyad.js";

describe("npc-mutual-chat", () => {
  beforeEach(() => {
    delete process.env.REDIS_URL;
    clearNpcMutualChatState();
    clearMockNpcMutualChatJobs();
    clearNpcMutualChatJobClaimsForTest();
    clearPersonalTimelineDyadState();
    clearMockPersonalTimelineJobs();
    clearPersonalTimelineJobClaimsForTest();
  });

  afterEach(() => {
    delete process.env.REDIS_URL;
  });

  it("D-MUTUAL-01/05: proximity + schedule filter selects eligible pairs (no hard veto by score)", async () => {
    expect(MUTUAL_CHAT_MAX_PER_DAY).toBe(3);

    const roomId = "room-mc-select";
    // Cluster of three within Chebyshev≤2; npc-4 far away.
    const npcs = [
      { id: "npc-1", x: 10, y: 10 },
      { id: "npc-2", x: 11, y: 10 },
      { id: "npc-3", x: 10, y: 11 },
      { id: "npc-4", x: 80, y: 80 },
    ];
    // Nemesis / low affection still eligible — score is weight only.
    const relationshipScores = new Map<string, number>([
      ["npc-1:npc-2", -80],
      ["npc-1:npc-3", 40],
      ["npc-2:npc-3", 10],
    ]);

    const { enqueued } = await maybeEnqueueNpcMutualChat({
      roomId,
      npcs,
      absoluteGameMinute: 1440 * 5 + 600, // midday — schedules active
      gameMinuteOfDay: 600,
      relationshipScores,
      forceSelectAllEligible: true,
      villageBandOnly: false,
    });

    expect(enqueued.length).toBeGreaterThan(0);
    expect(enqueued.length).toBeLessThanOrEqual(MUTUAL_CHAT_MAX_PER_DAY);

    const payloads = enqueued.map((id) => getMockNpcMutualChatJob(id));
    for (const job of payloads) {
      expect(job).toBeTruthy();
      expect(job!.roomId).toBe(roomId);
      expect(job!.dayIndex).toBe(5);
      expect(["npc-1", "npc-2", "npc-3"]).toContain(job!.npcAId);
      expect(["npc-1", "npc-2", "npc-3"]).toContain(job!.npcBId);
      expect(job!.npcAId).not.toBe(job!.npcBId);
      // Far npc-4 must not appear
      expect(job!.npcAId).not.toBe("npc-4");
      expect(job!.npcBId).not.toBe("npc-4");
    }

    // Nemesis pair npc-1↔npc-2 remains eligible (may or may not win sort; assert not vetoed from candidate set)
    const { candidates } = await maybeEnqueueNpcMutualChat({
      roomId: "room-mc-nemesis-check",
      npcs: [
        { id: "npc-1", x: 10, y: 10 },
        { id: "npc-2", x: 11, y: 10 },
      ],
      absoluteGameMinute: 1440 * 6 + 600,
      gameMinuteOfDay: 600,
      relationshipScores: new Map([["npc-1:npc-2", -99]]),
      forceSelectAllEligible: true,
      villageBandOnly: false,
      dryRun: true,
    });
    expect(candidates.some((c) => c.npcAId === "npc-1" && c.npcBId === "npc-2")).toBe(
      true,
    );
  });

  it("D-MUTUAL-03: daily stagger caps 2–3 pair triggers per game day with 12-seat rotation", async () => {
    const roomId = "room-mc-stagger";
    // Pack many council NPCs into one Chebyshev cluster so cap, not proximity, binds.
    const npcs = Array.from({ length: 8 }, (_, i) => ({
      id: `npc-${i + 1}`,
      x: 10 + (i % 3),
      y: 10 + Math.floor(i / 3),
    }));

    const first = await maybeEnqueueNpcMutualChat({
      roomId,
      npcs,
      absoluteGameMinute: 1440 * 10 + 600,
      gameMinuteOfDay: 600,
      forceSelectAllEligible: true,
      villageBandOnly: false,
    });
    expect(first.enqueued.length).toBeLessThanOrEqual(MUTUAL_CHAT_MAX_PER_DAY);
    expect(first.enqueued.length).toBeGreaterThan(0);

    const again = await maybeEnqueueNpcMutualChat({
      roomId,
      npcs,
      absoluteGameMinute: 1440 * 10 + 700,
      gameMinuteOfDay: 700,
      forceSelectAllEligible: true,
      villageBandOnly: false,
    });
    expect(again.enqueued.length).toBe(0);

    // Different day → bucket rotation allows new enqueues (cap resets).
    const nextDay = await maybeEnqueueNpcMutualChat({
      roomId,
      npcs,
      absoluteGameMinute: 1440 * 11 + 600,
      gameMinuteOfDay: 600,
      forceSelectAllEligible: true,
      villageBandOnly: false,
    });
    expect(nextDay.enqueued.length).toBeGreaterThan(0);
    expect(nextDay.enqueued.length).toBeLessThanOrEqual(MUTUAL_CHAT_MAX_PER_DAY);
  });

  it("D-MUTUAL-07: defers enqueue when player speak is in-progress (same as world-vote)", async () => {
    expect(shouldDeferNpcMutualChatEnqueue(1)).toBe(true);
    expect(shouldDeferNpcMutualChatEnqueue(0)).toBe(false);

    const deferred = await maybeEnqueueNpcMutualChat({
      roomId: "room-mc-defer",
      npcs: [
        { id: "npc-1", x: 10, y: 10 },
        { id: "npc-2", x: 11, y: 10 },
      ],
      absoluteGameMinute: 1440 * 4 + 600,
      gameMinuteOfDay: 600,
      npcSpeakInFlight: true,
      forceSelectAllEligible: true,
      villageBandOnly: false,
    });
    expect(deferred.enqueued).toEqual([]);
    expect(deferred.deferred).toBe(true);
  });

  it("D-MUTUAL / A2: mutual-chat supersedes ambient dyad for same room/day/pair claim", async () => {
    const roomId = "room-mc-supersede";
    const npcs = [
      { id: "npc-1", x: 10, y: 10 },
      { id: "npc-2", x: 11, y: 10 },
      { id: "npc-3", x: 10, y: 11 },
    ];
    const abs = 1440 * 7 + 600;

    const mc = await maybeEnqueueNpcMutualChat({
      roomId,
      npcs,
      absoluteGameMinute: abs,
      gameMinuteOfDay: 600,
      forceSelectAllEligible: true,
      villageBandOnly: false,
    });
    expect(mc.enqueued.length).toBeGreaterThan(0);

    const job = getMockNpcMutualChatJob(mc.enqueued[0]!);
    expect(job).toBeTruthy();
    expect(
      isPairClaimedForMutualChat(roomId, job!.dayIndex, job!.npcAId, job!.npcBId),
    ).toBe(true);

    const dyadIds = await maybeEnqueueDyadFromAmbient({
      roomId,
      npcs,
      absoluteGameMinute: abs,
      selectPct: 100,
    });
    // Claimed mutual pairs must not get a silent ambient dyad event.
    for (const id of dyadIds) {
      // If anything enqueued, it must not be the mutual-claimed pair — covered by claim check below.
      void id;
    }
    // Stronger: re-check that mutual pair stays claimed and ambient cannot claim same pair key.
    expect(
      isPairClaimedForMutualChat(roomId, job!.dayIndex, job!.npcAId, job!.npcBId),
    ).toBe(true);
    // With only 3 nearby NPCs and mutual taking up to 3 pairs, ambient should get nothing
    // (all close pairs claimed) or only unclaimed pairs — never re-fire claimed ones.
    expect(dyadIds.length).toBe(0);
  });

  it("queue claim NX + mock path blocks duplicate jobId without Redis", async () => {
    const {
      enqueueNpcMutualChatJob,
      claimNpcMutualChatJobId,
    } = await import("../queue/npc-mutual-chat.js");

    const input = {
      roomId: "room-mc-claim",
      npcAId: "npc-1",
      npcBId: "npc-2",
      dayIndex: 3,
      absoluteGameMinute: 1440 * 3 + 100,
    };
    const first = await enqueueNpcMutualChatJob(input);
    expect(first).toBeTruthy();
    expect(getMockNpcMutualChatJob(first!)?.npcAId).toBe("npc-1");

    const again = await enqueueNpcMutualChatJob(input);
    expect(again).toBeNull();

    expect(await claimNpcMutualChatJobId(first!)).toBe(false);
  });
});
