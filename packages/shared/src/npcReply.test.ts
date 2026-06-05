import { describe, expect, it } from "vitest";
import { sanitizeNpcReplyText } from "./npcReply.js";

describe("sanitizeNpcReplyText", () => {
  it("removes channel control tokens", () => {
    expect(sanitizeNpcReplyText("好的。<|channel|>thought")).toBe("好的。");
    expect(sanitizeNpcReplyText("路昂：没问题<|channel|>analysis")).toBe("路昂：没问题");
  });

  it("keeps normal Chinese reply", () => {
    const text = "没问题，我这就到你左边去。";
    expect(sanitizeNpcReplyText(text)).toBe(text);
  });
});
