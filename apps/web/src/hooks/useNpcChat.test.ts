import { describe, expect, it } from "vitest";
import {
  clearInFlightRefsForDrain,
  clearNpcJob,
  createNpcJobRegistry,
  dequeueNpcSpeak,
  discardQueuedSpeakMatching,
  enqueueNpcSpeak,
  isNpcSpeakInFlight,
  isTrackedSpeakJob,
  npcSpeakQueueDepth,
  registerNpcJob,
  resolveNpcForJob,
  type NpcSpeakQueue,
} from "./useNpcChat.js";

describe("npc speak queue helpers", () => {
  it("enqueue and dequeue preserve FIFO order", () => {
    const queues: NpcSpeakQueue = new Map();
    expect(enqueueNpcSpeak(queues, "npc-1", "first")).toBe(1);
    expect(enqueueNpcSpeak(queues, "npc-1", "second")).toBe(2);
    expect(npcSpeakQueueDepth(queues, "npc-1")).toBe(2);
    expect(dequeueNpcSpeak(queues, "npc-1")).toBe("first");
    expect(dequeueNpcSpeak(queues, "npc-1")).toBe("second");
    expect(dequeueNpcSpeak(queues, "npc-1")).toBeUndefined();
    expect(npcSpeakQueueDepth(queues, "npc-1")).toBe(0);
  });

  it("queues are independent per npcId", () => {
    const queues: NpcSpeakQueue = new Map();
    enqueueNpcSpeak(queues, "npc-1", "a");
    enqueueNpcSpeak(queues, "npc-2", "b");
    expect(dequeueNpcSpeak(queues, "npc-2")).toBe("b");
    expect(npcSpeakQueueDepth(queues, "npc-1")).toBe(1);
  });

  it("discardQueuedSpeakMatching removes duplicate retry text", () => {
    const queues: NpcSpeakQueue = new Map();
    enqueueNpcSpeak(queues, "npc-1", "你想我吗？");
    enqueueNpcSpeak(queues, "npc-1", "别的");
    expect(discardQueuedSpeakMatching(queues, "npc-1", "你想我吗？")).toBe(1);
    expect(npcSpeakQueueDepth(queues, "npc-1")).toBe(1);
    expect(dequeueNpcSpeak(queues, "npc-1")).toBe("别的");
  });
});

describe("isNpcSpeakInFlight", () => {
  it("blocks only the busy npc", () => {
    expect(
      isNpcSpeakInFlight({
        npcId: "npc-1",
        speakBusyNpcId: "npc-2",
        sendingNpcId: null,
        pendingJobNpcIds: [],
      }),
    ).toBe(false);
    expect(
      isNpcSpeakInFlight({
        npcId: "npc-1",
        speakBusyNpcId: null,
        sendingNpcId: "npc-1",
        pendingJobNpcIds: [],
      }),
    ).toBe(true);
    expect(
      isNpcSpeakInFlight({
        npcId: "npc-1",
        speakBusyNpcId: null,
        sendingNpcId: null,
        pendingJobNpcIds: ["npc-1"],
      }),
    ).toBe(true);
    expect(
      isNpcSpeakInFlight({
        npcId: "npc-1",
        speakBusyNpcId: null,
        sendingNpcId: "npc-2",
        pendingJobNpcIds: ["npc-1"],
      }),
    ).toBe(true);
  });
});

describe("NpcJobRegistry", () => {
  it("tracks parallel jobs per npc without overwriting the other", () => {
    const reg = createNpcJobRegistry();
    registerNpcJob(reg, "npc-1", "job-a");
    registerNpcJob(reg, "npc-3", "job-b");
    expect(isTrackedSpeakJob(reg, "job-a")).toBe(true);
    expect(isTrackedSpeakJob(reg, "job-b")).toBe(true);
    expect(resolveNpcForJob(reg, "job-a")).toBe("npc-1");
    expect(resolveNpcForJob(reg, "job-b")).toBe("npc-3");
    clearNpcJob(reg, "job-a");
    expect(isTrackedSpeakJob(reg, "job-a")).toBe(false);
    expect(isTrackedSpeakJob(reg, "job-b")).toBe(true);
  });
});

describe("clearInFlightRefsForDrain", () => {
  it("clears stale thinking ref so queued speak can drain after onDone", () => {
    const refs = {
      thinkingNpcId: { current: "npc-1" as string | null },
      speakBusyNpcId: { current: null as string | null },
      sendingNpcId: { current: null as string | null },
    };
    expect(
      isNpcSpeakInFlight({
        npcId: "npc-1",
        speakBusyNpcId: refs.speakBusyNpcId.current,
        sendingNpcId: refs.sendingNpcId.current,
        thinkingNpcId: refs.thinkingNpcId.current,
      }),
    ).toBe(true);
    clearInFlightRefsForDrain(refs, "npc-1");
    expect(
      isNpcSpeakInFlight({
        npcId: "npc-1",
        speakBusyNpcId: refs.speakBusyNpcId.current,
        sendingNpcId: refs.sendingNpcId.current,
        thinkingNpcId: refs.thinkingNpcId.current,
      }),
    ).toBe(false);
  });
});
