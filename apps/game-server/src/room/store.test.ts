import { describe, expect, it, beforeEach } from "vitest";
import { clearAllRooms, getOrCreate, reset } from "./store.js";

describe("room store", () => {
  beforeEach(() => {
    clearAllRooms();
  });

  it("reset restores default room state", () => {
    const roomId = "default";
    getOrCreate(roomId);
    reset(roomId);
    const fresh = getOrCreate(roomId);
    expect(fresh.state.npcs[0]).toEqual(expect.objectContaining({ id: "npc-1", x: 23, y: 10 }));
  });
});
