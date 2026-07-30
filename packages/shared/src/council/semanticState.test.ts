import { describe, expect, it } from "vitest";
import {
  NPC_MOODS,
  clampSemanticState,
  isNpcMood,
} from "./semanticState.js";

describe("NPC_MOODS", () => {
  it("is the closed Chinese 8-mood whitelist (D-BELIEF-08)", () => {
    expect([...NPC_MOODS]).toEqual([
      "平静",
      "亲近",
      "警惕",
      "恼火",
      "愉悦",
      "低落",
      "愧疚",
      "戏谑",
    ]);
  });

  it.each([...NPC_MOODS])("accepts whitelist mood %s", (mood) => {
    expect(isNpcMood(mood)).toBe(true);
    expect(clampSemanticState({ mood }).mood).toBe(mood);
  });
});

describe("clampSemanticState", () => {
  it("omits illegal mood so caller can preserve prior (D-BELIEF-07/08)", () => {
    expect(clampSemanticState({ mood: "friendly" }).mood).toBeUndefined();
    expect(clampSemanticState({ mood: "angry" }).mood).toBeUndefined();
    expect(clampSemanticState({ mood: "平静 " }).mood).toBeUndefined();
    expect(clampSemanticState({ mood: "" }).mood).toBeUndefined();
  });

  it("does not map English aliases to Chinese moods", () => {
    expect(clampSemanticState({ mood: "calm" }).mood).toBeUndefined();
    expect(clampSemanticState({ mood: "neutral" }).mood).toBeUndefined();
  });

  it("caps beliefs at 5 × ≤40 chars (D-BELIEF-04)", () => {
    const long = "我".repeat(50);
    const beliefs = [
      "  我不信他的承诺  ",
      long,
      "第二条",
      "第三条",
      "第四条",
      "第五条",
      "第六条应被丢弃",
    ];
    const clamped = clampSemanticState({ beliefs });
    expect(clamped.beliefs).toHaveLength(5);
    expect(clamped.beliefs![0]).toBe("我不信他的承诺");
    expect(clamped.beliefs![1]).toHaveLength(40);
    expect(clamped.beliefs).not.toContain("第六条应被丢弃");
  });

  it("drops empty belief strings after trim", () => {
    expect(clampSemanticState({ beliefs: ["  ", "有效"] }).beliefs).toEqual(["有效"]);
  });

  it("caps summary at 200 chars (D-BELIEF-04)", () => {
    const summary = "概".repeat(250);
    expect(clampSemanticState({ summary }).summary).toHaveLength(200);
  });

  it("omits fields that were not provided", () => {
    const clamped = clampSemanticState({});
    expect(clamped).toEqual({});
    expect(clampSemanticState({ mood: "愉悦" })).toEqual({ mood: "愉悦" });
  });

  it("allows empty beliefs array on success replace path (D-BELIEF-13)", () => {
    expect(clampSemanticState({ beliefs: [] }).beliefs).toEqual([]);
  });
});
