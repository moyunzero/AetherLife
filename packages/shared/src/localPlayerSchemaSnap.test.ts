import { describe, expect, it } from "vitest";
import { shouldSuppressLocalSchemaSnap } from "./localPlayerSchemaSnap.js";

describe("shouldSuppressLocalSchemaSnap (MP-MOV-02)", () => {
  it("suppresses when pending > 0", () => {
    expect(shouldSuppressLocalSchemaSnap({ pendingMoves: 1, isLocomoting: false })).toBe(true);
  });

  it("suppresses when locomoting", () => {
    expect(shouldSuppressLocalSchemaSnap({ pendingMoves: 0, isLocomoting: true })).toBe(true);
  });

  it("suppresses when local grid differs from lagging schema", () => {
    expect(
      shouldSuppressLocalSchemaSnap({
        pendingMoves: 0,
        isLocomoting: false,
        localX: 5,
        localY: 3,
        schemaX: 4,
        schemaY: 3,
      }),
    ).toBe(true);
  });

  it("allows snap only when idle, drained, and aligned with schema", () => {
    expect(
      shouldSuppressLocalSchemaSnap({
        pendingMoves: 0,
        isLocomoting: false,
        localX: 4,
        localY: 3,
        schemaX: 4,
        schemaY: 3,
      }),
    ).toBe(false);
  });
});
