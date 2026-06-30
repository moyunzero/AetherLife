import { describe, expect, it, beforeEach } from "vitest";
import { COUNCIL_NPC_IDS } from "@aetherlife/shared";
import { clearAllRooms, getOrCreate, reset, setState } from "./store.js";

describe("room store", () => {
  beforeEach(() => {
    clearAllRooms();
  });

  it("reset restores default room state with 12 council npcs", () => {
    const roomId = "default";
    getOrCreate(roomId);
    reset(roomId);
    const fresh = getOrCreate(roomId);
    expect(fresh.state.npcs).toHaveLength(12);
    expect(fresh.state.npcs.map((n) => n.id)).toEqual([...COUNCIL_NPC_IDS]);
  });

  it("auto-migrates legacy in-memory room on getOrCreate", () => {
    const roomId = "legacy-touch";
    const record = getOrCreate(roomId);
    record.state.npcs = [
      { id: "npc-1", name: "莫玄虚", x: 23, y: 10, status: "idle", inventory: ["key-1"] },
      { id: "npc-2", name: "阿斯托利亚", x: 9, y: 21, status: "idle", inventory: ["key-2"] },
      { id: "npc-3", name: "洛璃", x: 28, y: 27, status: "idle", inventory: ["note-1"] },
      {
        id: "bg-villager-1",
        name: "老张",
        x: 33,
        y: 11,
        status: "idle",
        inventory: [],
        isBackgroundNpc: true,
      },
    ];

    const migrated = getOrCreate(roomId);
    expect(migrated.state.npcs).toHaveLength(12);
    expect(migrated.state.npcs.find((n) => n.id === "npc-1")?.x).toBe(23);
    expect(migrated.state.npcs.some((n) => n.id.startsWith("bg-villager"))).toBe(false);
  });

  it("auto-migrates legacy state passed through setState", () => {
    const roomId = "legacy-room";
    setState(roomId, {
      roomId,
      width: 40,
      height: 40,
      player: { x: 34, y: 13 },
      npcs: [
        { id: "npc-1", name: "莫玄虚", x: 23, y: 10, status: "idle", inventory: ["key-1"] },
        { id: "npc-2", name: "阿斯托利亚", x: 9, y: 21, status: "idle", inventory: ["key-2"] },
        { id: "npc-3", name: "洛璃", x: 28, y: 27, status: "idle", inventory: ["note-1"] },
      ],
      objects: [],
    });

    const record = getOrCreate(roomId);
    expect(record.state.npcs).toHaveLength(12);
    expect(record.state.npcs.map((n) => n.id)).toEqual([...COUNCIL_NPC_IDS]);
    const npc1 = record.state.npcs.find((n) => n.id === "npc-1");
    expect(npc1?.x).toBe(23);
    expect(npc1?.y).toBe(10);
  });
});
