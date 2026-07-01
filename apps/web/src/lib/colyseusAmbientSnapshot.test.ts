import { describe, expect, it } from "vitest";
import { snapshotAmbientStateFromSchema } from "./colyseusAmbientSnapshot.js";

describe("snapshotAmbientStateFromSchema", () => {
  it("reads all council NPC slots from Colyseus npcs MapSchema", () => {
    const snap = snapshotAmbientStateFromSchema({
      gameMinute: 720,
      npcs: {
        forEach(fn) {
          fn(
            {
              x: 9,
              y: 20,
              activityKey: "socializing",
              intentReasonZh: "寒暄",
              joinVicinityActive: true,
              joinVicinityUntil: 100,
              joinVicinityStartedAt: 50,
              isThinking: true,
              isSpeaking: false,
            },
            "npc-1",
          );
          fn(
            {
              x: 3,
              y: 4,
              activityKey: "idle",
              isThinking: false,
              isSpeaking: true,
            },
            "npc-2",
          );
          fn({ x: 5, y: 6, activityKey: "reading" }, "npc-3");
          for (let i = 4; i <= 12; i += 1) {
            fn({ x: 10 + i, y: 10, activityKey: "idle" }, `npc-${i}`);
          }
        },
      },
    });

    expect(snap.gameClock.minute).toBe(720);
    expect(snap.roomNpcs).toHaveLength(12);
    expect(snap.roomNpcs[0]).toEqual(
      expect.objectContaining({
        id: "npc-1",
        x: 9,
        y: 20,
        activityKey: "socializing",
        isThinking: true,
      }),
    );
    expect(snap.roomNpcs[1]).toEqual(
      expect.objectContaining({ id: "npc-2", isSpeaking: true }),
    );
    expect(snap.npcActivityById["npc-1"]).toBe("socializing");
    expect(snap.npcAmbientById["npc-1"]?.joinVicinityActive).toBe(true);
  });
});
