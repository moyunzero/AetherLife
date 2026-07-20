import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  clearMockPersonalTimelineJobs,
  clearPersonalTimelineJobClaimsForTest,
  getMockPersonalTimelineJob,
} from "../queue/personal-timeline.js";
import {
  affectionDeltaFromSpeakText,
  clearPersonalTimelineDyadState,
  detectCouncilPeerMention,
  DYAD_MIN_ABS_DELTA,
  maybeEnqueueDyadFromAmbient,
  maybeEnqueueDyadFromSpeak,
} from "./personal-timeline-dyad.js";

describe("personal-timeline dyad", () => {
  beforeEach(() => {
    // Avoid hanging Redis claims when sibling suites load root .env REDIS_URL.
    delete process.env.REDIS_URL;
    clearPersonalTimelineDyadState();
    clearMockPersonalTimelineJobs();
    clearPersonalTimelineJobClaimsForTest();
  });

  afterEach(() => {
    delete process.env.REDIS_URL;
  });

  it("detects peer by displayName and npc id", () => {
    expect(detectCouncilPeerMention("去找楚浅歌聊聊", "npc-2")).toBe("npc-9");
    expect(detectCouncilPeerMention("问一下 npc-9", "npc-2")).toBe("npc-9");
    expect(detectCouncilPeerMention("今天天气不错", "npc-2")).toBeNull();
    expect(detectCouncilPeerMention("阿斯托利亚本人", "npc-2")).toBeNull();
  });

  it("biases affection from keywords; casual mention is 0 (medium bar)", () => {
    expect(affectionDeltaFromSpeakText("我支持你")).toBe(4);
    expect(affectionDeltaFromSpeakText("你们争执不断")).toBe(-4);
    expect(affectionDeltaFromSpeakText("路过")).toBe(0);
    expect(DYAD_MIN_ABS_DELTA).toBe(4);
  });

  it("skips speak dyad when affection below medium bar", async () => {
    const skipped = await maybeEnqueueDyadFromSpeak({
      roomId: "room-dyad-neutral",
      speakerNpcId: "npc-2",
      playerMessage: "楚浅歌最近怎样？",
      npcReply: "哼，那个享乐派。",
      absoluteGameMinute: 1440 * 2,
    });
    expect(skipped).toBeNull();
  });

  it("enqueues speak dyad once per pair per day when keywords fire", async () => {
    const roomId = "room-dyad-speak";
    const first = await maybeEnqueueDyadFromSpeak({
      roomId,
      speakerNpcId: "npc-2",
      playerMessage: "我支持楚浅歌的提案。",
      npcReply: "哼，那个享乐派。",
      absoluteGameMinute: 1440 * 2,
    });
    expect(first).toBeTruthy();
    const job = getMockPersonalTimelineJob(first!);
    expect(job).toMatchObject({
      kind: "event",
      roomId,
      npcId: "npc-2",
      counterpartNpcId: "npc-9",
      affectionDelta: 4,
    });

    const again = await maybeEnqueueDyadFromSpeak({
      roomId,
      speakerNpcId: "npc-2",
      playerMessage: "再赞楚浅歌",
      absoluteGameMinute: 1440 * 2 + 10,
    });
    expect(again).toBeNull();
  });

  it("durable pair claim blocks re-enqueue after local dyad state cleared", async () => {
    const roomId = "room-dyad-durable";
    const first = await maybeEnqueueDyadFromSpeak({
      roomId,
      speakerNpcId: "npc-2",
      playerMessage: "感谢楚浅歌。",
      absoluteGameMinute: 1440 * 3,
    });
    expect(first).toBeTruthy();

    clearPersonalTimelineDyadState();
    const again = await maybeEnqueueDyadFromSpeak({
      roomId,
      speakerNpcId: "npc-2",
      playerMessage: "再次感谢楚浅歌。",
      absoluteGameMinute: 1440 * 3 + 5,
    });
    expect(again).toBeNull();
  });

  it("ambient enqueues nearby selected pairs with room day cap", async () => {
    const roomId = "room-dyad-amb";
    const npcs = [
      { id: "npc-1", x: 10, y: 10 },
      { id: "npc-2", x: 11, y: 10 },
      { id: "npc-3", x: 10, y: 11 },
      { id: "npc-4", x: 50, y: 50 },
    ];
    const first = await maybeEnqueueDyadFromAmbient({
      roomId,
      npcs,
      absoluteGameMinute: 1440 * 5,
      selectPct: 100,
    });
    expect(first.length).toBe(2);
    for (const id of first) {
      const job = getMockPersonalTimelineJob(id);
      expect(job?.kind).toBe("event");
      expect((job as { affectionDelta?: number }).affectionDelta).toBe(
        DYAD_MIN_ABS_DELTA,
      );
    }

    const again = await maybeEnqueueDyadFromAmbient({
      roomId,
      npcs,
      absoluteGameMinute: 1440 * 5 + 20,
      selectPct: 100,
    });
    expect(again).toEqual([]);
  });

  it("durable ambient slot claim survives local state clear", async () => {
    const roomId = "room-dyad-amb-durable";
    const npcs = [
      { id: "npc-1", x: 10, y: 10 },
      { id: "npc-2", x: 11, y: 10 },
      { id: "npc-3", x: 10, y: 11 },
    ];
    const first = await maybeEnqueueDyadFromAmbient({
      roomId,
      npcs,
      absoluteGameMinute: 1440 * 6,
      selectPct: 100,
    });
    expect(first.length).toBe(2);

    clearPersonalTimelineDyadState();
    const again = await maybeEnqueueDyadFromAmbient({
      roomId,
      npcs,
      absoluteGameMinute: 1440 * 6 + 1,
      selectPct: 100,
    });
    expect(again).toEqual([]);
  });
});
