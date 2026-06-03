import { describe, expect, it } from "vitest";
import { parseGameAction, safeParseGameAction } from "./parse.js";

describe("GameActionSchema", () => {
  it("parses valid move", () => {
    expect(parseGameAction({ type: "move", x: 1, y: 2 })).toEqual({
      type: "move",
      x: 1,
      y: 2,
    });
  });

  it("parses valid interact", () => {
    expect(parseGameAction({ type: "interact", objectId: "door-1" })).toEqual({
      type: "interact",
      objectId: "door-1",
    });
  });

  it("parses valid speak", () => {
    expect(
      parseGameAction({ type: "speak", targetId: "npc-1", content: "hello" }),
    ).toEqual({ type: "speak", targetId: "npc-1", content: "hello" });
  });

  it("parses valid wait", () => {
    expect(parseGameAction({ type: "wait", durationMs: 1000 })).toEqual({
      type: "wait",
      durationMs: 1000,
    });
  });

  it("rejects unknown type", () => {
    expect(() => parseGameAction({ type: "fly", x: 0, y: 0 })).toThrow();
  });

  it("rejects extra fields on strict schemas", () => {
    const result = safeParseGameAction({
      type: "move",
      x: 1,
      y: 2,
      extra: true,
    });
    expect(result.success).toBe(false);
  });

  it("rejects speak with empty content", () => {
    const result = safeParseGameAction({
      type: "speak",
      targetId: "npc-1",
      content: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects speak content over 2000 chars", () => {
    const result = safeParseGameAction({
      type: "speak",
      targetId: "npc-1",
      content: "x".repeat(2001),
    });
    expect(result.success).toBe(false);
  });

  it("rejects wait durationMs zero", () => {
    const result = safeParseGameAction({ type: "wait", durationMs: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects negative wait durationMs", () => {
    const result = safeParseGameAction({ type: "wait", durationMs: -1 });
    expect(result.success).toBe(false);
  });
});
