import { beforeEach, describe, expect, it } from "vitest";
import { COUNCIL_NPC_IDS, createDefaultRoom } from "@aetherlife/shared";
import { getOrCreate } from "../room/store.js";
import { validateChatNpcId } from "./npc-chat.js";

describe("validateChatNpcId", () => {
  beforeEach(() => {
    getOrCreate("npc-chat-council-test");
  });

  it("allows all 12 council NPC ids for speak", () => {
    for (const npcId of COUNCIL_NPC_IDS) {
      expect(validateChatNpcId("npc-chat-council-test", npcId)).toBe(npcId);
    }
  });

  it("allows npc-4, npc-7, npc-12 explicitly", () => {
    expect(validateChatNpcId("npc-chat-council-test", "npc-4")).toBe("npc-4");
    expect(validateChatNpcId("npc-chat-council-test", "npc-7")).toBe("npc-7");
    expect(validateChatNpcId("npc-chat-council-test", "npc-12")).toBe("npc-12");
  });

  it("returns null for unknown ids", () => {
    expect(validateChatNpcId("npc-chat-council-test", "missing-npc")).toBeNull();
    expect(validateChatNpcId("npc-chat-council-test", "bg-villager-1")).toBeNull();
  });
});

describe("createDefaultRoom council tier", () => {
  it("seeds twelve council npcs without background villagers", () => {
    const room = createDefaultRoom("council-seed");
    expect(room.npcs).toHaveLength(12);
    expect(room.npcs.map((n) => n.id)).toEqual([...COUNCIL_NPC_IDS]);
    expect(room.npcs.some((n) => n.isBackgroundNpc)).toBe(false);
  });
});
