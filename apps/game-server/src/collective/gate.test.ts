import { describe, expect, it } from "vitest";
import {
  allowedToolsForBand,
  attitudeGateResponse,
  isActionBlockedByGate,
} from "./gate.js";

describe("attitude gate", () => {
  it("hostile rejects move and transfer", () => {
    expect(isActionBlockedByGate("move", "hostile")).toBe(true);
    expect(isActionBlockedByGate("transfer", "hostile")).toBe(true);
    expect(isActionBlockedByGate("interact", "hostile")).toBe(true);
    expect(allowedToolsForBand("hostile")).toEqual(["speak", "wait"]);
  });

  it("neutral allows all action tools", () => {
    expect(isActionBlockedByGate("move", "neutral")).toBe(false);
    expect(allowedToolsForBand("neutral")).toContain("move");
  });

  it("attitudeGateResponse shape for verify scripts", () => {
    expect(attitudeGateResponse("hostile", "move", 0)).toEqual({
      ok: false,
      error: "attitude_gate",
      code: "hostile_gate",
      band: "hostile",
      actionType: "move",
      applied: 0,
    });
  });
});
