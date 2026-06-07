import { describe, expect, it } from "vitest";
import {
  detectCollaborateTransfer,
  detectCompeteObject,
  detectSpeakRule,
  recordNpcTransfer,
  recordObjectInteract,
} from "./rule-detector.js";

describe("detectSpeakRule", () => {
  it("detects rude keywords", () => {
    expect(detectSpeakRule("你真粗鲁")).toEqual({ kind: "rude", summary: "玩家言语粗鲁" });
    expect(detectSpeakRule("你来打我啊，你是个变态")).toEqual({
      kind: "rude",
      summary: "玩家言语粗鲁",
    });
    expect(detectSpeakRule("你是不是有病？")).toEqual({
      kind: "rude",
      summary: "玩家言语粗鲁",
    });
    expect(detectSpeakRule("你好丑啊，活该被打")).toEqual({
      kind: "rude",
      summary: "玩家言语粗鲁",
    });
  });

  it("returns ambiguous for social friction without fixed kind", () => {
    expect(detectSpeakRule("你可真会聊天啊，什么玩意")).toEqual({ ambiguous: true });
  });

  it("detects help keywords", () => {
    expect(detectSpeakRule("请帮忙拿一下")).toEqual({ kind: "help", summary: "玩家请求帮助" });
  });

  it("returns null for neutral text", () => {
    expect(detectSpeakRule("今天天气不错")).toBeNull();
  });
});

describe("object and transfer rules", () => {
  it("detects compete_object within window", () => {
    const map = new Map<string, { playerId: string; at: number }>();
    const now = 1_000_000;
    recordObjectInteract("door-1", "p-a", map, now - 1000);
    const result = detectCompeteObject("door-1", "p-b", map, now, 5000);
    expect(result?.kind).toBe("compete_object");
    expect(result?.playerIds).toEqual(["p-a", "p-b"]);
  });

  it("detects collaborate transfer", () => {
    const map = new Map<string, { playerId: string; at: number }>();
    const now = 1_000_000;
    recordNpcTransfer("npc-1", "p-a", map, now - 500);
    const result = detectCollaborateTransfer("npc-1", "p-b", map, now, 5000);
    expect(result?.kind).toBe("collaborate");
  });
});
