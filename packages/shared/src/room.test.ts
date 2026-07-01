import { describe, expect, it } from "vitest";
import { COUNCIL_NPC_IDS } from "./council/constants.js";
import {
  getCouncilSpawnSlots,
  shuffleCouncilSpawnAssignments,
} from "./council/spawn.js";
import {
  defaultBeginningFieldsBundle,
  loadWorldRegistry,
  setWorldRegistry,
} from "./worldRegion.js";
import { HOME_DEFAULT_PLAYER_SPAWN } from "./homeMap.js";
import { createDefaultRoom, findNpc } from "./room.js";

describe("createDefaultRoom", () => {
  it("seeds player spawn from homeMap", () => {
    setWorldRegistry(loadWorldRegistry(defaultBeginningFieldsBundle()));
    const room = createDefaultRoom();
    expect(room.player).toEqual(HOME_DEFAULT_PLAYER_SPAWN);
  });

  it("returns exactly 12 council npc ids with embassy home anchors", () => {
    setWorldRegistry(loadWorldRegistry(defaultBeginningFieldsBundle()));
    const room = createDefaultRoom("room-twelve");
    expect(room.npcs).toHaveLength(12);
    expect(room.npcs.map((n) => n.id)).toEqual([...COUNCIL_NPC_IDS]);
    expect(room.npcs.some((n) => n.isBackgroundNpc)).toBe(false);
    expect(room.npcs.some((n) => n.id.startsWith("bg-villager"))).toBe(false);
    for (const npc of room.npcs) {
      expect(npc.homeX).toBe(npc.x);
      expect(npc.homeY).toBe(npc.y);
      expect(npc.maxRadius).toBeGreaterThanOrEqual(0);
    }
  });

  it("shuffles id-to-slot assignments per roomId", () => {
    setWorldRegistry(loadWorldRegistry(defaultBeginningFieldsBundle()));
    const slots = getCouncilSpawnSlots();
    const a = shuffleCouncilSpawnAssignments("room-a", slots);
    const b = shuffleCouncilSpawnAssignments("room-b", slots);
    const aPositions = a.map((x) => `${x.slot.x},${x.slot.y}`).join("|");
    const bPositions = b.map((x) => `${x.slot.x},${x.slot.y}`).join("|");
    expect(aPositions).not.toBe(bPositions);
  });

  it("preserves legacy starter inventories for npc-1..3", () => {
    setWorldRegistry(loadWorldRegistry(defaultBeginningFieldsBundle()));
    const room = createDefaultRoom();
    expect(room.npcs[0]?.name).toBe("莫玄虚");
    expect(room.npcs[0]?.inventory).toEqual(["key-1"]);
    expect(room.npcs[1]?.inventory).toEqual(["key-2"]);
    expect(room.npcs[2]?.inventory).toEqual(["note-1"]);
  });

  it("clones starter inventory per room (no shared array refs)", () => {
    setWorldRegistry(loadWorldRegistry(defaultBeginningFieldsBundle()));
    const a = createDefaultRoom("room-inv-a");
    const b = createDefaultRoom("room-inv-b");
    const invA = a.npcs.find((n) => n.id === "npc-1")?.inventory;
    const invB = b.npcs.find((n) => n.id === "npc-1")?.inventory;
    expect(invA).toEqual(["key-1"]);
    expect(invB).toEqual(["key-1"]);
    expect(invA).not.toBe(invB);
    invA?.push("mutated");
    expect(b.npcs.find((n) => n.id === "npc-1")?.inventory).toEqual(["key-1"]);
  });
});

describe("findNpc", () => {
  it("returns npc by id or undefined", () => {
    setWorldRegistry(loadWorldRegistry(defaultBeginningFieldsBundle()));
    const room = createDefaultRoom();
    expect(findNpc(room, "npc-2")?.name).toBe("阿斯托利亚");
    expect(findNpc(room, "missing")).toBeUndefined();
  });
});
