import { describe, expect, it } from "vitest";
import { stripNpcsForViewport } from "./stripNpcsForViewport.js";

const NPCS = [
  { id: "a", name: "A" },
  { id: "b", name: "B" },
  { id: "c", name: "C" },
];

describe("stripNpcsForViewport", () => {
  it("returns all npcs when Phaser is unavailable (grid fallback)", () => {
    expect(stripNpcsForViewport(NPCS, false, [])).toEqual(NPCS);
  });

  it("filters to viewport-visible ids when Phaser is active", () => {
    expect(stripNpcsForViewport(NPCS, true, ["b", "c"])).toEqual([
      { id: "b", name: "B" },
      { id: "c", name: "C" },
    ]);
  });

  it("returns empty when Phaser is active but viewport list is empty", () => {
    expect(stripNpcsForViewport(NPCS, true, [])).toEqual([]);
  });
});
