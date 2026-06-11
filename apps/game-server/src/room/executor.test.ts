import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  createDefaultRoom,
  defaultBeginningFieldsBundle,
  findNpc,
  loadWorldRegistry,
} from "@aetherlife/shared";
import bfCollisionFixture from "../../data/world/beginning-fields@v1/collision.json";
import {
  bootBeginningFieldsCollision,
  resetRegionWalkabilityForTests,
} from "../world/region-walkability.js";
import { applyGameAction, ExecutorError } from "./executor.js";

describe("applyGameAction", () => {
  it("move changes acting npc position only", () => {
    const room = createDefaultRoom();
    const { room: next } = applyGameAction(room, { type: "move", x: 5, y: 5 }, "npc-1");
    expect(findNpc(next, "npc-1")?.x).toBe(5);
    expect(findNpc(next, "npc-1")?.y).toBe(5);
    expect(findNpc(next, "npc-2")?.x).toBe(9);
    expect(findNpc(next, "npc-2")?.y).toBe(21);
  });

  it("interact toggles door for acting npc context", () => {
    const room = createDefaultRoom();
    room.objects = [{ id: "door-1", kind: "door", x: 3, y: 3, state: "closed" }];
    const { room: next } = applyGameAction(room, { type: "interact", objectId: "door-1" }, "npc-1");
    expect(next.objects[0]?.state).toBe("open");
  });

  it("transfer moves key-1 from npc-1 to npc-2", () => {
    const room = createDefaultRoom();
    const { room: next } = applyGameAction(
      room,
      { type: "transfer", itemId: "key-1", toNpcId: "npc-2" },
      "npc-1",
    );
    expect(findNpc(next, "npc-1")?.inventory).not.toContain("key-1");
    expect(findNpc(next, "npc-2")?.inventory).toContain("key-1");
  });

  it("transfer rejects missing item", () => {
    const room = createDefaultRoom();
    expect(() =>
      applyGameAction(
        room,
        { type: "transfer", itemId: "missing", toNpcId: "npc-2" },
        "npc-1",
      ),
    ).toThrow(ExecutorError);
  });

  it("transfer rejects unknown target npc", () => {
    const room = createDefaultRoom();
    expect(() =>
      applyGameAction(
        room,
        { type: "transfer", itemId: "key-1", toNpcId: "npc-9" },
        "npc-1",
      ),
    ).toThrow(/unknown target npc/);
  });

  it("transfer rejects self target", () => {
    const room = createDefaultRoom();
    expect(() =>
      applyGameAction(
        room,
        { type: "transfer", itemId: "key-1", toNpcId: "npc-1" },
        "npc-1",
      ),
    ).toThrow(/cannot transfer item to self/);
  });

  it("rejects out of bounds move", () => {
    const room = createDefaultRoom();
    expect(() => applyGameAction(room, { type: "move", x: 99, y: 0 }, "npc-1")).toThrow(
      ExecutorError,
    );
  });

  it("rejects unknown acting npc", () => {
    const room = createDefaultRoom();
    expect(() => applyGameAction(room, { type: "move", x: 1, y: 1 }, "npc-9")).toThrow(
      ExecutorError,
    );
  });

  it("snaps move onto another npc to nearest walkable cell", () => {
    const room = createDefaultRoom();
    findNpc(room, "npc-1")!.x = 4;
    findNpc(room, "npc-1")!.y = 2;
    findNpc(room, "npc-2")!.x = 5;
    findNpc(room, "npc-2")!.y = 2;
    const { room: next } = applyGameAction(room, { type: "move", x: 5, y: 2 }, "npc-1");
    const npc = findNpc(next, "npc-1");
    expect(npc?.x === 5 && npc?.y === 2).toBe(false);
    expect(findNpc(next, "npc-2")?.x).toBe(5);
    expect(findNpc(next, "npc-2")?.y).toBe(2);
  });

  it("snaps move onto player cell to adjacent walkable cell", () => {
    const room = createDefaultRoom();
    room.player = { x: 4, y: 4 };
    findNpc(room, "npc-1")!.x = 3;
    findNpc(room, "npc-1")!.y = 4;
    const { room: next } = applyGameAction(room, { type: "move", x: 4, y: 4 }, "npc-1");
    const npc = findNpc(next, "npc-1");
    expect(npc?.x === 4 && npc?.y === 4).toBe(false);
    expect(Math.abs((npc?.x ?? 0) - 4) + Math.abs((npc?.y ?? 0) - 4)).toBe(1);
  });

  it("snaps move onto door cell to nearest walkable cell", () => {
    const room = createDefaultRoom();
    room.objects = [{ id: "door-1", kind: "door", x: 3, y: 3, state: "closed" }];
    const { room: next } = applyGameAction(room, { type: "move", x: 3, y: 3 }, "npc-1");
    const npc = findNpc(next, "npc-1");
    expect(npc?.x === 3 && npc?.y === 3).toBe(false);
  });

  describe("with beginning-fields collision", () => {
    beforeEach(() => {
      resetRegionWalkabilityForTests();
      loadWorldRegistry(defaultBeginningFieldsBundle());
      bootBeginningFieldsCollision(bfCollisionFixture as {
        width: number;
        height: number;
        cells: number[];
      });
    });

    afterEach(() => {
      resetRegionWalkabilityForTests();
    });

    it("snaps near Fisher to walkable neighbor not blocked terrain (9,20)", () => {
      const room = createDefaultRoom();
      findNpc(room, "npc-2")!.x = 9;
      findNpc(room, "npc-2")!.y = 21;
      const { room: next } = applyGameAction(
        room,
        { type: "move", x: 9, y: 20 },
        "npc-1",
        {
          otherPlayerCells: [{ x: 20, y: 13 }],
          moveSnapAnchor: { x: 9, y: 21 },
        },
      );
      const npc1 = findNpc(next, "npc-1");
      expect(npc1?.x === 9 && npc1?.y === 20).toBe(false);
      expect(npc1?.x === 9 && npc1?.y === 21).toBe(false);
      const distToFeixue =
        Math.abs((npc1?.x ?? 0) - 9) + Math.abs((npc1?.y ?? 0) - 21);
      expect(distToFeixue).toBe(1);
    });
  });

  it("snaps blocked NPC-relative move to neighbor of moveSnapAnchor not player", () => {
    const room = createDefaultRoom();
    room.player = { x: 20, y: 13 };
    findNpc(room, "npc-1")!.x = 20;
    findNpc(room, "npc-1")!.y = 13;
    findNpc(room, "npc-2")!.x = 9;
    findNpc(room, "npc-2")!.y = 21;
    const { room: next } = applyGameAction(
      room,
      { type: "move", x: 9, y: 21 },
      "npc-1",
      {
        otherPlayerCells: [{ x: 20, y: 13 }],
        moveSnapAnchor: { x: 9, y: 21 },
        moveAnchorCell: { x: 20, y: 13 },
      },
    );
    const npc1 = findNpc(next, "npc-1");
    expect(npc1?.x === 9 && npc1?.y === 21).toBe(false);
    const distToFeixue =
      Math.abs((npc1?.x ?? 0) - 9) + Math.abs((npc1?.y ?? 0) - 21);
    expect(distToFeixue).toBe(1);
    const distToPlayer =
      Math.abs((npc1?.x ?? 0) - 20) + Math.abs((npc1?.y ?? 0) - 13);
    expect(distToPlayer).toBeGreaterThan(1);
  });

  it("prefers initiator-adjacent cell when target below player is blocked", () => {
    const room = createDefaultRoom();
    room.player = { x: 4, y: 2 };
    findNpc(room, "npc-1")!.x = 4;
    findNpc(room, "npc-1")!.y = 3;
    const { room: next } = applyGameAction(
      room,
      { type: "move", x: 4, y: 3 },
      "npc-2",
      {
        otherPlayerCells: [{ x: 4, y: 2 }],
        moveAnchorCell: { x: 4, y: 2 },
      },
    );
    const npc2 = findNpc(next, "npc-2");
    expect(npc2?.x === 4 && npc2?.y === 3).toBe(false);
    const dist =
      Math.abs((npc2?.x ?? 0) - 4) + Math.abs((npc2?.y ?? 0) - 2);
    expect(dist).toBe(1);
  });
});
