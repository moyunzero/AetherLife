import { createDefaultRoom } from "@aetherlife/shared";
import { describe, expect, it } from "vitest";
import { applyMapAndBumpVersion, bumpStateVersion } from "./version.js";
import { GameRoomState } from "./schema.js";

describe("stateVersion", () => {
  it("bumps monotonically", () => {
    const state = new GameRoomState();
    expect(state.stateVersion).toBe(0);
    expect(bumpStateVersion(state)).toBe(1);
    expect(bumpStateVersion(state)).toBe(2);
  });

  it("applyMapAndBumpVersion returns increasing version", () => {
    const state = new GameRoomState();
    const map = createDefaultRoom();
    const first = applyMapAndBumpVersion(state, map);
    const second = applyMapAndBumpVersion(state, map);
    expect(second.stateVersion).toBeGreaterThan(first.stateVersion);
  });
});
