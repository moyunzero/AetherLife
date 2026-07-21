import { describe, expect, it } from "vitest";
import {
  MUTUAL_BUBBLE_MAX_CHARS,
  truncateMutualBubbleText,
} from "./MutualChatBubbleLogic.js";

describe("MutualChatBubbleLogic", () => {
  it("truncates and strips control characters", () => {
    expect(truncateMutualBubbleText("  hi\x00there  ")).toBe("hithere");
    expect(truncateMutualBubbleText("a".repeat(25)).length).toBe(MUTUAL_BUBBLE_MAX_CHARS);
  });
});
