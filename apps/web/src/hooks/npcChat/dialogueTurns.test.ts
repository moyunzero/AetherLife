import { describe, expect, it } from "vitest";
import { recentDialogueTurnsForNpc } from "./dialogueTurns.js";
import type { ChatMessage } from "./types.js";

describe("recentDialogueTurnsForNpc", () => {
  it("pairs player lines with matching npc thread only", () => {
    const messages: ChatMessage[] = [
      { id: "1", role: "player", text: "a", npcId: "npc-5" },
      { id: "2", role: "npc", text: "r1", npcId: "npc-1" },
      { id: "3", role: "player", text: "b", npcId: "npc-5" },
      { id: "4", role: "npc", text: "r5", npcId: "npc-5" },
    ];
    expect(recentDialogueTurnsForNpc(messages, "npc-5")).toEqual([
      { role: "player", text: "b" },
      { role: "npc", text: "r5" },
    ]);
  });

  it("excludes interleaved player messages targeting other npcs", () => {
    const messages: ChatMessage[] = [
      { id: "1", role: "player", text: "to-1a", npcId: "npc-1" },
      { id: "2", role: "npc", text: "from-1a", npcId: "npc-1" },
      { id: "3", role: "player", text: "to-5", npcId: "npc-5" },
      { id: "4", role: "npc", text: "from-5", npcId: "npc-5" },
      { id: "5", role: "player", text: "to-1b", npcId: "npc-1" },
      { id: "6", role: "npc", text: "from-1b", npcId: "npc-1" },
    ];
    expect(recentDialogueTurnsForNpc(messages, "npc-1")).toEqual([
      { role: "player", text: "to-1a" },
      { role: "npc", text: "from-1a" },
      { role: "player", text: "to-1b" },
      { role: "npc", text: "from-1b" },
    ]);
    expect(recentDialogueTurnsForNpc(messages, "npc-5")).toEqual([
      { role: "player", text: "to-5" },
      { role: "npc", text: "from-5" },
    ]);
  });
});
