import { describe, expect, it } from "vitest";
import { snapshotAmbientStateFromSchema } from "./colyseusAmbientSnapshot.js";

describe("snapshotAmbientStateFromSchema", () => {
  it("reads main and background NPC grid from Colyseus schema fields", () => {
    const snap = snapshotAmbientStateFromSchema({
      gameMinute: 720,
      npc1X: 9,
      npc1Y: 20,
      npc2X: 3,
      npc2Y: 4,
      npc3X: 5,
      npc3Y: 6,
      npc1ActivityKey: "socializing",
      npc2ActivityKey: "idle",
      npc3ActivityKey: "idle",
      bgNpc1Active: true,
      bgNpc1X: 11,
      bgNpc1Y: 12,
      bgNpc1ActivityKey: "wandering",
      bgNpc2Active: false,
    });

    expect(snap.gameClock.minute).toBe(720);
    expect(snap.mainNpcGridById).toEqual({
      "npc-1": { x: 9, y: 20 },
      "npc-2": { x: 3, y: 4 },
      "npc-3": { x: 5, y: 6 },
    });
    expect(snap.bgNpcGridById).toEqual({
      "bg-villager-1": { x: 11, y: 12 },
    });
    expect(snap.npcActivityById["npc-1"]).toBe("socializing");
  });
});
