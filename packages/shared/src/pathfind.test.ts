import { describe, expect, it } from "vitest";
import { createDefaultRoom } from "./room.js";
import {
  buildMoveGrid,
  canStepTo,
  findGridPath,
  findNearestWalkableCell,
} from "./pathfind.js";

describe("findGridPath", () => {
  it("finds straight path", () => {
    const map = createDefaultRoom();
    const grid = buildMoveGrid(map, []);
    expect(findGridPath(4, 4, 6, 4, grid)?.at(-1)).toEqual({ x: 6, y: 4 });
  });

  it("paths around closed door", () => {
    const map = createDefaultRoom();
    map.objects[0]!.state = "closed";
    const grid = buildMoveGrid(map, []);
    const path = findGridPath(4, 4, 4, 0, grid);
    expect(path).not.toBeNull();
    expect(path!.some((c) => c.x === 3 && c.y === 3)).toBe(false);
  });

  it("returns null for npc cell target", () => {
    const map = createDefaultRoom();
    const grid = buildMoveGrid(map, []);
    expect(findGridPath(4, 4, 2, 2, grid)).toBeNull();
  });

  it("blocks open door cells", () => {
    const map = createDefaultRoom();
    map.objects[0]!.state = "open";
    const grid = buildMoveGrid(map, []);
    expect(grid.isBlocked(3, 3)).toBe(true);
    expect(findGridPath(4, 4, 3, 3, grid)).toBeNull();
  });

  it("excludeNpcId allows pathing through acting npc start only", () => {
    const map = createDefaultRoom();
    const grid = buildMoveGrid(map, [], { excludeNpcId: "npc-1" });
    expect(grid.isBlocked(2, 2)).toBe(false);
    expect(grid.isBlocked(5, 2)).toBe(true);
  });

  it("canStepTo rejects npc, door, and player cells", () => {
    const map = createDefaultRoom();
    expect(canStepTo(map, 2, 2, [])).toBe(false);
    expect(canStepTo(map, 3, 3, [])).toBe(false);
    expect(canStepTo(map, 5, 2, [])).toBe(false);
    expect(canStepTo(map, 6, 4, [])).toBe(true);
    expect(canStepTo(map, 4, 4, [{ x: 4, y: 4 }])).toBe(false);
  });

  it("findNearestWalkableCell skips blocked spawn", () => {
    const map = createDefaultRoom();
    const cell = findNearestWalkableCell(map, 4, 4, [{ x: 4, y: 4 }]);
    expect(cell).not.toEqual({ x: 4, y: 4 });
    expect(canStepTo(map, cell.x, cell.y, [{ x: 4, y: 4 }])).toBe(true);
  });
});
