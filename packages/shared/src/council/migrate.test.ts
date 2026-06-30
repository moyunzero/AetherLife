import { describe, expect, it } from "vitest";
import { createDefaultRoom } from "../room.js";
import { defaultBeginningFieldsBundle, loadWorldRegistry, setWorldRegistry } from "../worldRegion.js";
import { migrateRoomCouncilNpcs } from "./migrate.js";

describe("migrateRoomCouncilNpcs", () => {
  it("leaves 12-council rooms unchanged", () => {
    setWorldRegistry(loadWorldRegistry(defaultBeginningFieldsBundle()));
    const room = createDefaultRoom("already-twelve");
    const result = migrateRoomCouncilNpcs(room);
    expect(result.changed).toBe(false);
    expect(result.reason).toBe("already-12-council");
  });

  it("migrates legacy 3-seat + bg-villager to 12 council while preserving coords", () => {
    setWorldRegistry(loadWorldRegistry(defaultBeginningFieldsBundle()));
    const legacy = {
      roomId: "legacy-three-seat",
      width: 40,
      height: 40,
      player: { x: 34, y: 13 },
      npcs: [
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
      ],
      objects: [],
    };

    const result = migrateRoomCouncilNpcs(legacy);
    expect(result.changed).toBe(true);
    expect(result.state.npcs).toHaveLength(12);
    expect(result.state.npcs.some((n) => n.id.startsWith("bg-villager"))).toBe(false);
    const npc1 = result.state.npcs.find((n) => n.id === "npc-1");
    expect(npc1?.x).toBe(23);
    expect(npc1?.y).toBe(10);
  });
});
