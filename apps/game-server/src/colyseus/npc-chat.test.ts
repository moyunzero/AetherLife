import { beforeEach, describe, expect, it } from "vitest";
import { createDefaultRoom } from "@aetherlife/shared";
import { getOrCreate } from "../room/store.js";
import { validateChatNpcId } from "./npc-chat.js";

describe("validateChatNpcId", () => {
  beforeEach(() => {
    getOrCreate("npc-chat-bg-test");
  });

  it("rejects background NPC ids for speak", () => {
    const room = getOrCreate("npc-chat-bg-test");
    expect(room.state.npcs.some((n) => n.id === "bg-villager-1")).toBe(true);

    expect(validateChatNpcId("npc-chat-bg-test", "bg-villager-1")).toBeNull();
    expect(validateChatNpcId("npc-chat-bg-test", "bg-villager-4")).toBeNull();
  });

  it("allows main NPC ids", () => {
    expect(validateChatNpcId("npc-chat-bg-test", "npc-1")).toBe("npc-1");
    expect(validateChatNpcId("npc-chat-bg-test", "npc-3")).toBe("npc-3");
  });

  it("returns null for unknown ids", () => {
    expect(validateChatNpcId("npc-chat-bg-test", "missing-npc")).toBeNull();
  });
});

describe("createDefaultRoom background tier", () => {
  it("seeds four background villagers with wander zone", () => {
    const room = createDefaultRoom("bg-seed");
    const bg = room.npcs.filter((n) => n.isBackgroundNpc);
    expect(bg).toHaveLength(4);
    expect(bg.every((n) => n.backgroundWanderZoneId?.includes(":plaza")
      || n.backgroundWanderZoneId?.includes(":orchard")
      || n.backgroundWanderZoneId?.includes(":pond"))).toBe(true);
  });
});
