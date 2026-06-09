import { describe, expect, it } from "vitest";
import { cardinalFacingFromDelta, schemaFacingToCardinal, snapDiagonalToCardinal } from "./facing.js";

describe("facing", () => {
  it("maps diagonal (1,1) to a single cardinal via dominant axis tie-break", () => {
    expect(cardinalFacingFromDelta(1, 1)).toBe("right");
    expect(snapDiagonalToCardinal(1, 1)).toBe("right");
  });

  it("maps pure axis deltas", () => {
    expect(cardinalFacingFromDelta(0, -1)).toBe("up");
    expect(cardinalFacingFromDelta(0, 1)).toBe("down");
    expect(cardinalFacingFromDelta(-1, 0)).toBe("left");
    expect(cardinalFacingFromDelta(1, 0)).toBe("right");
  });

  it("prefers vertical when |dy| > |dx|", () => {
    expect(cardinalFacingFromDelta(1, 2)).toBe("down");
    expect(cardinalFacingFromDelta(-1, -3)).toBe("up");
  });

  it("maps Colyseus schema facings n/s/e/w (ISSUE-040)", () => {
    expect(schemaFacingToCardinal("n")).toBe("up");
    expect(schemaFacingToCardinal("s")).toBe("down");
    expect(schemaFacingToCardinal("w")).toBe("left");
    expect(schemaFacingToCardinal("e")).toBe("right");
  });
});
