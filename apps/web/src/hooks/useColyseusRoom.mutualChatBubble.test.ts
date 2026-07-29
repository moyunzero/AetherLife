import { describe, expect, it } from "vitest";
import { COLYSEUS_SERVER_MESSAGES } from "@aetherlife/shared";
import {
  MUTUAL_BUBBLE_MAX_CHARS,
  shouldShowMutualChatBubble,
  truncateMutualBubbleText,
} from "../game/MutualChatBubbleLogic.js";

describe("useColyseusRoom mutualChatBubble (D-MUTUAL-02)", () => {
  it("uses one-shot Colyseus message constant (not schema)", () => {
    expect(COLYSEUS_SERVER_MESSAGES.mutualChatBubble).toBe("mutualChatBubble");
  });

  it("clamps bubble text to ≤20 characters", () => {
    const long = "一二三四五六七八九十abcdefghijklmnop";
    const out = truncateMutualBubbleText(long);
    expect(out.length).toBeLessThanOrEqual(MUTUAL_BUBBLE_MAX_CHARS);
    expect(out).toBe(long.slice(0, MUTUAL_BUBBLE_MAX_CHARS));
  });

  it("gates visibility at Chebyshev ≤2", () => {
    expect(shouldShowMutualChatBubble(5, 5, 5, 5)).toBe(true);
    expect(shouldShowMutualChatBubble(5, 5, 7, 5)).toBe(true);
    expect(shouldShowMutualChatBubble(5, 5, 8, 5)).toBe(false);
  });
});
