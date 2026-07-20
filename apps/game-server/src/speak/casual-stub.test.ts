import { describe, expect, it } from "vitest";
import { previewCasualSpeakStub } from "@aetherlife/shared";

describe("previewCasualSpeakStub", () => {
  it("returns stub for B1 benchmark message", () => {
    const stub = previewCasualSpeakStub("你好，用一句话简短回复");
    expect(stub).toBeTruthy();
    expect(stub!.length).toBeGreaterThan(0);
  });

  it("returns null for recall message", () => {
    expect(previewCasualSpeakStub("你好，还记得密码吗")).toBeNull();
  });

  it("returns null for physical message", () => {
    expect(previewCasualSpeakStub("向右走一步")).toBeNull();
  });

  it("returns null when recent turns present", () => {
    const history = [
      { role: "player" as const, text: "干嘛呢？" },
      { role: "npc" as const, text: "在忙" },
    ];
    expect(previewCasualSpeakStub("你好，用一句话简短回复", history)).toBeNull();
  });
});
