import { describe, expect, it } from "vitest";
import {
  canUseCasualFastLane,
  pickCasualReply,
  previewCasualSpeakStub,
} from "./casualSpeakStub.js";
import {
  classifySpeakIntent,
  shouldSkipMemoryContext,
  SpeakIntent,
} from "./speakIntent.js";
import { stableStringHash } from "./stableStringHash.js";

describe("classifySpeakIntent", () => {
  it("physical intent", () => {
    expect(classifySpeakIntent("向右走一步")).toBe(SpeakIntent.PHYSICAL);
    expect(classifySpeakIntent("打开门")).toBe(SpeakIntent.PHYSICAL);
    expect(classifySpeakIntent("去费雪旁边")).toBe(SpeakIntent.PHYSICAL);
    expect(classifySpeakIntent("move to (3,4)")).toBe(SpeakIntent.PHYSICAL);
    expect(classifySpeakIntent("请帮我走到左侧")).toBe(SpeakIntent.PHYSICAL);
  });

  it("recall intent", () => {
    expect(classifySpeakIntent("你还记得密码吗")).toBe(SpeakIntent.RECALL);
    expect(classifySpeakIntent("上次说的数字是多少")).toBe(SpeakIntent.RECALL);
    expect(classifySpeakIntent("之前告诉你的门牌号是什么")).toBe(SpeakIntent.RECALL);
    expect(classifySpeakIntent("还记得我们说过什么吗")).toBe(SpeakIntent.RECALL);
    expect(classifySpeakIntent("你提过那个约定吗")).toBe(SpeakIntent.RECALL);
  });

  it("recall wins over casual greeting", () => {
    expect(classifySpeakIntent("你好，还记得密码吗")).toBe(SpeakIntent.RECALL);
  });

  it("social edge intent", () => {
    expect(classifySpeakIntent("你这个废物")).toBe(SpeakIntent.SOCIAL_EDGE);
    expect(classifySpeakIntent("请帮帮我")).toBe(SpeakIntent.SOCIAL_EDGE);
    expect(classifySpeakIntent("滚开")).toBe(SpeakIntent.SOCIAL_EDGE);
    expect(classifySpeakIntent("你真蠢")).toBe(SpeakIntent.SOCIAL_EDGE);
    expect(classifySpeakIntent("能请你帮个忙吗")).toBe(SpeakIntent.SOCIAL_EDGE);
  });

  it("casual intent", () => {
    expect(classifySpeakIntent("你好")).toBe(SpeakIntent.CASUAL);
    expect(classifySpeakIntent("Hi")).toBe(SpeakIntent.CASUAL);
    expect(classifySpeakIntent("早上好")).toBe(SpeakIntent.CASUAL);
    expect(classifySpeakIntent("用一句话简短回复")).toBe(SpeakIntent.CASUAL);
    expect(classifySpeakIntent("你好，用一句话简短回复")).toBe(SpeakIntent.CASUAL);
  });

  it("narrative default", () => {
    expect(classifySpeakIntent("故宫在哪里，给我讲讲历史")).toBe(SpeakIntent.NARRATIVE);
    expect(classifySpeakIntent("那里有什么历史？")).toBe(SpeakIntent.NARRATIVE);
    expect(classifySpeakIntent("这个世界是怎么形成的")).toBe(SpeakIntent.NARRATIVE);
    expect(classifySpeakIntent("")).toBe(SpeakIntent.NARRATIVE);
    expect(classifySpeakIntent("你在做什么呢？")).toBe(SpeakIntent.NARRATIVE);
    expect(classifySpeakIntent("你在做什么呢～")).toBe(SpeakIntent.NARRATIVE);
    expect(classifySpeakIntent("你喜欢做什么呢？")).toBe(SpeakIntent.NARRATIVE);
    expect(classifySpeakIntent("今天不错")).toBe(SpeakIntent.NARRATIVE);
    expect(classifySpeakIntent("你好狂啊～")).toBe(SpeakIntent.NARRATIVE);
    expect(classifySpeakIntent("在啥啊")).toBe(SpeakIntent.NARRATIVE);
  });

  it("casual skips memory context", () => {
    expect(shouldSkipMemoryContext(SpeakIntent.CASUAL)).toBe(true);
    expect(shouldSkipMemoryContext(SpeakIntent.PHYSICAL)).toBe(true);
    expect(shouldSkipMemoryContext(SpeakIntent.RECALL)).toBe(false);
    expect(shouldSkipMemoryContext(SpeakIntent.NARRATIVE)).toBe(false);
  });
});

describe("casual reply pool", () => {
  it("pick casual reply greeting stable", () => {
    const a = pickCasualReply("你好");
    const b = pickCasualReply("你好");
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it("pick casual reply meta brief stable", () => {
    const msg = "你好，用一句话简短回复";
    const a = pickCasualReply(msg);
    const b = pickCasualReply(msg);
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it("preview casual stub b1", () => {
    const msg = "你好，用一句话简短回复";
    const stub = previewCasualSpeakStub(msg);
    expect(stub).toBeTruthy();
    expect(stub).toBe(pickCasualReply(msg));
  });

  it("preview casual stub narrative none", () => {
    expect(previewCasualSpeakStub("故宫在哪里，给我讲讲历史")).toBeNull();
    expect(previewCasualSpeakStub("你在做什么呢？")).toBeNull();
    expect(previewCasualSpeakStub("你好狂啊～")).toBeNull();
    expect(previewCasualSpeakStub("在啥啊")).toBeNull();
  });

  it("can use casual fast lane b1", () => {
    const result = canUseCasualFastLane("你好，用一句话简短回复");
    expect(result?.intent).toBe(SpeakIntent.CASUAL);
    expect(result?.stub).toBeTruthy();
  });

  it("can use casual fast lane recall blocked", () => {
    expect(canUseCasualFastLane("你好，还记得密码吗")).toBeNull();
  });

  it("can use casual fast lane physical blocked", () => {
    expect(canUseCasualFastLane("向右走一步")).toBeNull();
  });

  it("stable hash cross-language fixture", () => {
    const msg = "你好，用一句话简短回复";
    const metaBriefPool = [
      "嗯，我在听。",
      "好的，说吧。",
      "明白，请讲。",
      "好，我听着呢。",
    ];
    const h = stableStringHash(msg);
    expect(pickCasualReply(msg)).toBe(metaBriefPool[h % metaBriefPool.length]);
  });
});
