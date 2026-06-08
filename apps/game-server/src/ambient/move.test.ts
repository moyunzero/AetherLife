import { describe, expect, it } from "vitest";
import type { GlobalMoveGrid } from "@aetherlife/shared";
import { buildOtherNpcCells, stepNpcTowardTarget } from "./move.js";

function mockGrid(blockedKeys: Set<string>): GlobalMoveGrid {
  return {
    isTerrainWalkable: () => true,
    isBlocked: (gx, gy) => blockedKeys.has(`${gx},${gy}`),
  };
}

describe("stepNpcTowardTarget", () => {
  it("moves at most one cell along path", () => {
    const grid = mockGrid(new Set());
    const result = stepNpcTowardTarget({
      npcX: 2,
      npcY: 2,
      targetGx: 5,
      targetGy: 2,
      grid,
      playerCells: [],
      otherNpcCells: [],
    });
    expect(result).toEqual({ moved: true, x: 3, y: 2 });
  });

  it("stays put when path[1] is player-occupied", () => {
    const grid = mockGrid(new Set());
    const result = stepNpcTowardTarget({
      npcX: 2,
      npcY: 2,
      targetGx: 5,
      targetGy: 2,
      grid,
      playerCells: [{ x: 3, y: 2 }],
      otherNpcCells: [],
    });
    expect(result).toEqual({ moved: false, x: 2, y: 2 });
  });

  it("stays put when path is empty or only start cell", () => {
    const grid = mockGrid(new Set());
    const atTarget = stepNpcTowardTarget({
      npcX: 4,
      npcY: 4,
      targetGx: 4,
      targetGy: 4,
      grid,
      playerCells: [],
      otherNpcCells: [],
    });
    expect(atTarget).toEqual({ moved: false, x: 4, y: 4 });

    const blockedTarget = stepNpcTowardTarget({
      npcX: 2,
      npcY: 2,
      targetGx: 9,
      targetGy: 9,
      grid: mockGrid(new Set(["9,9"])),
      playerCells: [],
      otherNpcCells: [],
    });
    expect(blockedTarget).toEqual({ moved: false, x: 2, y: 2 });
  });

  it("stays put when path[1] is other-NPC-occupied", () => {
    const grid = mockGrid(new Set());
    const result = stepNpcTowardTarget({
      npcX: 2,
      npcY: 2,
      targetGx: 3,
      targetGy: 2,
      grid,
      playerCells: [],
      otherNpcCells: [{ x: 3, y: 2 }],
    });
    expect(result).toEqual({ moved: false, x: 2, y: 2 });
  });
});

describe("buildOtherNpcCells", () => {
  it("excludes the acting npc", () => {
    const cells = buildOtherNpcCells(
      {
        roomId: "r",
        width: 8,
        height: 8,
        player: { x: 4, y: 4 },
        npcs: [
          { id: "npc-1", name: "a", x: 2, y: 2, status: "idle", inventory: [] },
          { id: "npc-2", name: "b", x: 5, y: 2, status: "idle", inventory: [] },
        ],
        objects: [],
      },
      "npc-1",
    );
    expect(cells).toEqual([{ x: 5, y: 2 }]);
  });
});
