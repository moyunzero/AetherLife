import { describe, expect, it } from "vitest";
import { isReasonZhRedundantWithActivity } from "./intentContent.js";

describe("isReasonZhRedundantWithActivity", () => {
  it("flags activity paraphrase", () => {
    expect(isReasonZhRedundantWithActivity("reading", "在看书")).toBe(true);
    expect(isReasonZhRedundantWithActivity("patrol", "四处看看")).toBe(true);
  });

  it("allows distinct motivation", () => {
    expect(isReasonZhRedundantWithActivity("reading", "想找安静角落")).toBe(false);
    expect(isReasonZhRedundantWithActivity("patrol", "心里还惦记着件事")).toBe(false);
  });
});
