import { createDefaultRoom } from "@aetherlife/shared";
import { describe, expect, it } from "vitest";
import { applyStatePatch } from "./applyStatePatch.js";

describe("applyStatePatch", () => {
  it("updates npc positions from delta", () => {
    const state = createDefaultRoom();
    const next = applyStatePatch(state, {
      npcs: [{ id: "npc-1", x: 1, y: 1 }],
    });
    expect(next.npcs.find((n) => n.id === "npc-1")?.x).toBe(1);
  });

  it("ignores stale versions at call site (caller gates)", () => {
    const state = createDefaultRoom();
    state.objects = [{ id: "door-1", kind: "door", x: 3, y: 3, state: "closed" }];
    const v1 = applyStatePatch(state, { doorOpen: true });
    const v2 = applyStatePatch(v1, { doorOpen: false });
    expect(v2.objects.find((o) => o.id === "door-1")?.state).toBe("closed");
  });
});
