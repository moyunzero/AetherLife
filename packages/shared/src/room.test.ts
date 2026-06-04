import { describe, expect, it } from "vitest";
import { createDefaultRoom, findNpc } from "./room.js";

describe("createDefaultRoom", () => {
  it("returns three distinct npc ids with seeded inventories", () => {
    const room = createDefaultRoom();
    expect(room.npcs).toHaveLength(3);
    expect(room.npcs.map((n) => n.id)).toEqual(["npc-1", "npc-2", "npc-3"]);
    expect(room.npcs[0]?.name).toBe("路昂");
    expect(room.npcs[0]?.inventory).toEqual(["key-1"]);
    expect(room.npcs[1]?.inventory).toEqual(["key-2"]);
    expect(room.npcs[2]?.inventory).toEqual(["note-1"]);
  });
});

describe("findNpc", () => {
  it("returns npc by id or undefined", () => {
    const room = createDefaultRoom();
    expect(findNpc(room, "npc-2")?.name).toBe("费雪");
    expect(findNpc(room, "missing")).toBeUndefined();
  });
});
