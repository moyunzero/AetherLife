import { describe, expect, it } from "vitest";
import { createDefaultRoom, findNpc, type GameObject, type RoomState } from "./room.js";
import {
  buildMoveGrid,
  canStepTo,
  findGridPath,
  findNearestWalkableCell,
} from "./pathfind.js";

const DOOR_AT_33: GameObject = {
  id: "door-1",
  kind: "door",
  x: 3,
  y: 3,
  state: "closed",
};

function roomWithDoor(state: RoomState["objects"][number]["state"] = "closed"): RoomState {
  const map = createDefaultRoom();
  map.objects = [{ ...DOOR_AT_33, state }];
  return map;
}

describe("findGridPath", () => {
  it("finds straight path", () => {
    const map = createDefaultRoom();
    const grid = buildMoveGrid(map, []);
    const from = map.player;
    const to = { x: from.x + 2, y: from.y };
    expect(findGridPath(from.x, from.y, to.x, to.y, grid)?.at(-1)).toEqual(to);
  });

  it("paths around closed door", () => {
    const map = roomWithDoor("closed");
    const grid = buildMoveGrid(map, []);
    const path = findGridPath(4, 4, 4, 0, grid);
    expect(path).not.toBeNull();
    expect(path!.some((c) => c.x === 3 && c.y === 3)).toBe(false);
  });

  it("returns null for npc cell target", () => {
    const map = createDefaultRoom();
    const npc1 = findNpc(map, "npc-1")!;
    const grid = buildMoveGrid(map, []);
    expect(findGridPath(npc1.x + 2, npc1.y + 2, npc1.x, npc1.y, grid)).toBeNull();
  });

  it("allows stepping through open door cells", () => {
    const map = roomWithDoor("open");
    const grid = buildMoveGrid(map, []);
    expect(grid.isBlocked(3, 3)).toBe(false);
    expect(findGridPath(4, 4, 3, 3, grid)?.at(-1)).toEqual({ x: 3, y: 3 });
  });

  it("excludeNpcId allows pathing through acting npc start only", () => {
    const map = createDefaultRoom();
    const npc1 = findNpc(map, "npc-1")!;
    const npc2 = findNpc(map, "npc-2")!;
    const grid = buildMoveGrid(map, [], { excludeNpcId: "npc-1" });
    expect(grid.isBlocked(npc1.x, npc1.y)).toBe(false);
    expect(grid.isBlocked(npc2.x, npc2.y)).toBe(true);
  });

  it("canStepTo rejects npc, door, and player cells", () => {
    const map = createDefaultRoom();
    const npc1 = findNpc(map, "npc-1")!;
    const npc2 = findNpc(map, "npc-2")!;
    expect(canStepTo(map, npc1.x, npc1.y, [])).toBe(false);
    expect(canStepTo(map, 3, 3, [])).toBe(true);
    const withDoor = roomWithDoor("closed");
    expect(canStepTo(withDoor, 3, 3, [])).toBe(false);
    expect(canStepTo(map, npc2.x, npc2.y, [])).toBe(false);
    expect(canStepTo(map, map.player.x + 2, map.player.y, [])).toBe(true);
    expect(canStepTo(map, map.player.x, map.player.y, [{ x: map.player.x, y: map.player.y }])).toBe(
      false,
    );
  });

  it("findNearestWalkableCell skips blocked spawn", () => {
    const map = createDefaultRoom();
    const blocked = { x: map.player.x, y: map.player.y };
    const cell = findNearestWalkableCell(map, blocked.x, blocked.y, [blocked]);
    expect(cell).not.toEqual(blocked);
    expect(canStepTo(map, cell.x, cell.y, [blocked])).toBe(true);
  });
});
