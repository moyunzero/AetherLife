import { describe, expect, it, beforeEach } from "vitest";
import {
  appendCompletedTurn,
  clearDialogueSessions,
  getRecentTurns,
} from "./dialogue-session.js";

describe("dialogue-session", () => {
  beforeEach(() => {
    clearDialogueSessions();
  });

  it("returns empty then appends player/npc pair on completed turn", () => {
    expect(getRecentTurns("default", "p1", "npc-1")).toEqual([]);

    appendCompletedTurn({
      roomId: "default",
      playerId: "p1",
      npcId: "npc-1",
      playerMessage: "你喜欢我吗？",
      npcReply: "我没有那种喜欢。",
    });

    expect(getRecentTurns("default", "p1", "npc-1")).toEqual([
      { role: "player", text: "你喜欢我吗？" },
      { role: "npc", text: "我没有那种喜欢。" },
    ]);
  });

  it("scopes threads by player and npc", () => {
    appendCompletedTurn({
      roomId: "default",
      playerId: "p1",
      npcId: "npc-1",
      playerMessage: "a",
      npcReply: "b",
    });
    appendCompletedTurn({
      roomId: "default",
      playerId: "p2",
      npcId: "npc-1",
      playerMessage: "c",
      npcReply: "d",
    });

    expect(getRecentTurns("default", "p1", "npc-1")).toHaveLength(2);
    expect(getRecentTurns("default", "p2", "npc-1")[0]?.text).toBe("c");
  });
});
