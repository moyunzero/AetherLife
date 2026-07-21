import { describe, expect, it } from "vitest";
import {
  applyPendingUiEvents,
  buildResultToast,
  IDLE_CORE,
  mergeLinkedEdgesHint,
  reduceDeliberationSync,
  type DeliberationCoreState,
} from "./useCouncilDeliberation.js";

const IDLE: DeliberationCoreState = {
  active: false,
  voteKind: "regular",
  phase: "proposal",
  round: 0,
  roundTotal: 2,
  proposalTitle: "",
  feedRows: [],
  linkedEdges: [],
};

describe("reduceDeliberationSync", () => {
  it("appends feedDelta rows when speak is idle", () => {
    const payload = {
      active: true,
      voteKind: "regular" as const,
      phase: "debate" as const,
      round: 1,
      roundTotal: 2,
      proposalTitle: "测试提案",
      feedDelta: [
        {
          kind: "quote" as const,
          npcId: "npc-1",
          displayName: "莫玄虚",
          text: "本席以为当慎重行事。",
        },
      ],
    };
    const { core, deferred, immediateToasts } = reduceDeliberationSync(IDLE, payload, {
      speakBusy: false,
    });
    expect(core.feedRows).toHaveLength(1);
    expect(core.feedRows[0]?.text).toContain("慎重");
    expect(deferred).toHaveLength(0);
    expect(immediateToasts).toHaveLength(0);
  });

  it("defers feedDelta when speakBusy", () => {
    const payload = {
      active: true,
      voteKind: "regular" as const,
      phase: "debate" as const,
      round: 1,
      roundTotal: 2,
      proposalTitle: "测试提案",
      feedDelta: [
        {
          kind: "quote" as const,
          npcId: "npc-2",
          displayName: "海莲娜",
          text: "旅者所言不无道理。",
          travelerRef: true,
        },
      ],
    };
    const { core, deferred } = reduceDeliberationSync(IDLE, payload, { speakBusy: true });
    expect(core.feedRows).toHaveLength(0);
    expect(deferred).toEqual([
      {
        type: "append_feed",
        rows: payload.feedDelta,
      },
    ]);
  });

  it("clears feed on sealed phase", () => {
    const prev: DeliberationCoreState = {
      ...IDLE,
      active: true,
      feedRows: [
        {
          kind: "quote",
          npcId: "npc-1",
          displayName: "莫玄虚",
          text: "旧引语",
        },
      ],
    };
    const { core } = reduceDeliberationSync(prev, {
      active: true,
      voteKind: "regular",
      phase: "sealed",
      round: 2,
      roundTotal: 2,
      proposalTitle: "落槌提案",
      clearFeed: true,
      resultEntryId: "wh-vote-1",
      status: "accepted",
      yesCount: 7,
      noCount: 4,
    }, { speakBusy: false });
    expect(core.feedRows).toHaveLength(0);
    expect(core.phase).toBe("sealed");
    expect(core.active).toBe(false);
  });

  it("clears active on sealed even when payload.active is true", () => {
    const prev: DeliberationCoreState = {
      ...IDLE,
      active: true,
      proposalTitle: "审议中",
    };
    const { core } = reduceDeliberationSync(prev, {
      active: true,
      voteKind: "regular",
      phase: "sealed",
      round: 2,
      roundTotal: 2,
      proposalTitle: "落槌提案",
      clearFeed: true,
      resultEntryId: "wh-vote-1",
      status: "accepted",
      yesCount: 7,
      noCount: 4,
    }, { speakBusy: false });
    expect(core.active).toBe(false);
  });

  it("replaces linkedEdges at deliberation start", () => {
    const prev: DeliberationCoreState = {
      ...IDLE,
      linkedEdges: [{ npcAId: "npc-1", npcBId: "npc-2" }],
    };
    const { core } = reduceDeliberationSync(prev, {
      active: true,
      voteKind: "regular",
      phase: "proposal",
      round: 0,
      roundTotal: 2,
      linkedEdges: [{ npcAId: "npc-3", npcBId: "npc-4" }],
    }, { speakBusy: false });
    expect(core.linkedEdges).toEqual([{ npcAId: "npc-3", npcBId: "npc-4" }]);
  });
});

describe("mergeLinkedEdgesHint", () => {
  it("unions by undirected pair without clearing unrelated prior hints", () => {
    const prev = [
      { npcAId: "npc-1", npcBId: "npc-2" },
      { npcAId: "npc-3", npcBId: "npc-4" },
    ];
    const next = mergeLinkedEdgesHint(prev, [
      { npcAId: "npc-2", npcBId: "npc-1" },
      { npcAId: "npc-5", npcBId: "npc-6" },
    ]);
    expect(next).toEqual(
      expect.arrayContaining([
        { npcAId: "npc-1", npcBId: "npc-2" },
        { npcAId: "npc-3", npcBId: "npc-4" },
        { npcAId: "npc-5", npcBId: "npc-6" },
      ]),
    );
    expect(next).toHaveLength(3);
  });
});

describe("applyPendingUiEvents", () => {
  it("flushes deferred feed and toasts FIFO on speak idle", () => {
    const core: DeliberationCoreState = {
      ...IDLE,
      active: true,
      proposalTitle: "测试",
    };
    const events = [
      {
        type: "append_feed" as const,
        rows: [
          {
            kind: "quote" as const,
            npcId: "npc-1",
            displayName: "莫玄虚",
            text: "排队引语",
          },
        ],
      },
      {
        type: "toast" as const,
        toast: {
          kind: "deliberation_start" as const,
          proposalTitle: "测试",
        },
      },
    ];
    const { core: flushed, toasts } = applyPendingUiEvents(core, events);
    expect(flushed.feedRows).toHaveLength(1);
    expect(toasts).toHaveLength(1);
    expect(toasts[0]?.kind).toBe("deliberation_start");
  });
});

describe("buildResultToast", () => {
  it("builds accepted toast with tally", () => {
    const toast = buildResultToast({
      voteKind: "regular",
      status: "accepted",
      proposalTitle: "廷议通过案",
      yesCount: 7,
      noCount: 4,
      resultEntryId: "wh-1",
    });
    expect(toast?.kind).toBe("vote_accepted");
    if (toast?.kind === "vote_accepted") {
      expect(toast.yesCount).toBe(7);
    }
  });

  it("builds epoch toast for epoch vote kind", () => {
    const toast = buildResultToast({
      voteKind: "epoch",
      status: "accepted",
      proposalTitle: "纪元大议",
      yesCount: 8,
      noCount: 3,
      resultEntryId: "wh-epoch",
    });
    expect(toast?.kind).toBe("vote_epoch");
  });
});

describe("IDLE_CORE export", () => {
  it("exports idle defaults", () => {
    expect(IDLE_CORE.active).toBe(false);
  });
});
