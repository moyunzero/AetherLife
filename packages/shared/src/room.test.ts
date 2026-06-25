import { describe, expect, it } from "vitest";
import {
  BG_VILLAGER_IDS,
} from "./backgroundNpc.js";
import {
  HOME_DEFAULT_PLAYER_SPAWN,
  HOME_NPC_SPAWNS,
} from "./homeMap.js";
import { createDefaultRoom, findNpc } from "./room.js";

describe("createDefaultRoom", () => {
  it("seeds player and npc spawns from homeMap", () => {
    const room = createDefaultRoom();
    expect(room.player).toEqual(HOME_DEFAULT_PLAYER_SPAWN);
    expect(room.npcs.slice(0, 3).map((n) => ({ id: n.id, x: n.x, y: n.y }))).toEqual([
      { id: "npc-1", ...HOME_NPC_SPAWNS["npc-1"] },
      { id: "npc-2", ...HOME_NPC_SPAWNS["npc-2"] },
      { id: "npc-3", ...HOME_NPC_SPAWNS["npc-3"] },
    ]);
  });

  it("returns three main npc ids plus four background villagers", () => {
    const room = createDefaultRoom();
    expect(room.npcs).toHaveLength(7);
    expect(room.npcs.slice(0, 3).map((n) => n.id)).toEqual(["npc-1", "npc-2", "npc-3"]);
    expect(room.npcs.slice(3).map((n) => n.id)).toEqual([...BG_VILLAGER_IDS]);
    expect(room.npcs[0]?.name).toBe("莫玄虚");
    expect(room.npcs[0]?.inventory).toEqual(["key-1"]);
    expect(room.npcs[1]?.inventory).toEqual(["key-2"]);
    expect(room.npcs[2]?.inventory).toEqual(["note-1"]);
    expect(room.npcs[3]?.isBackgroundNpc).toBe(true);
    expect(room.npcs[3]?.activityKey).toBe("wandering");
  });
});

describe("findNpc", () => {
  it("returns npc by id or undefined", () => {
    const room = createDefaultRoom();
    expect(findNpc(room, "npc-2")?.name).toBe("阿斯托利亚");
    expect(findNpc(room, "missing")).toBeUndefined();
  });
});
