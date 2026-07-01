import { describe, expect, it } from "vitest";
import { activityFontPx, nameplateFontPx } from "./entityLayout.js";

describe("scene label typography", () => {
  it("uses compact sizes at CELL_PX=32", () => {
    expect(nameplateFontPx()).toBe(10);
    expect(activityFontPx()).toBe(9);
  });
});
