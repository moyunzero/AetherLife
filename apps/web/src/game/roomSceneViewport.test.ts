import { describe, expect, it } from "vitest";
import { CELL_PX } from "./gridLayout.js";
import {
  hitNpcAtWorldPoint,
  npcIdAtGridCell,
  pickNpcAtWorldPoint,
  tickViewportVisibleNpcIds,
} from "./roomSceneViewport.js";
import type { EntitySprite } from "./roomSceneTypes.js";

type Rect = { x: number; y: number; width: number; height: number };

function mockEntity(
  opts: {
    npcId: string;
    visible?: boolean;
    bounds: Rect;
    depth?: number;
    gridX?: number;
    gridY?: number;
  },
): EntitySprite {
  const { npcId, visible = true, bounds, depth = 0, gridX = 0, gridY = 0 } = opts;
  return {
    npcId,
    gridX,
    gridY,
    container: {
      visible,
      depth,
      getBounds: () => bounds,
    },
  } as EntitySprite;
}

function mockCam(worldView: Rect) {
  return { worldView };
}

describe("tickViewportVisibleNpcIds", () => {
  it("returns sorted ids overlapping camera worldView", () => {
    const view: Rect = { x: 0, y: 0, width: 100, height: 100 };
    const insideA: Rect = { x: 10, y: 10, width: 20, height: 20 };
    const insideB: Rect = { x: 50, y: 50, width: 10, height: 10 };
    const outside: Rect = { x: 200, y: 200, width: 20, height: 20 };
    const sprites = new Map<string, EntitySprite>([
      ["npc-b", mockEntity({ npcId: "npc-b", bounds: insideB })],
      ["npc-a", mockEntity({ npcId: "npc-a", bounds: insideA })],
      ["npc-off", mockEntity({ npcId: "npc-off", bounds: outside })],
    ]);
    expect(tickViewportVisibleNpcIds(mockCam(view), sprites)).toEqual(["npc-a", "npc-b"]);
  });

  it("returns empty array when no sprites overlap view", () => {
    const view: Rect = { x: 0, y: 0, width: 100, height: 100 };
    const outside: Rect = { x: 500, y: 500, width: 20, height: 20 };
    const sprites = new Map<string, EntitySprite>([
      ["npc-far", mockEntity({ npcId: "npc-far", bounds: outside })],
    ]);
    expect(tickViewportVisibleNpcIds(mockCam(view), sprites)).toEqual([]);
  });

  it("excludes hidden containers and background NPCs", () => {
    const view: Rect = { x: 0, y: 0, width: 100, height: 100 };
    const box: Rect = { x: 10, y: 10, width: 20, height: 20 };
    const sprites = new Map<string, EntitySprite>([
      ["npc-main", mockEntity({ npcId: "npc-main", bounds: box })],
      ["npc-hidden", mockEntity({ npcId: "npc-hidden", visible: false, bounds: box })],
      ["bg-villager-1", mockEntity({ npcId: "bg-villager-1", bounds: box })],
    ]);
    expect(tickViewportVisibleNpcIds(mockCam(view), sprites)).toEqual(["npc-main"]);
  });
});

describe("hitNpcAtWorldPoint", () => {
  it("returns top-most NPC at world point", () => {
    const box: Rect = { x: 0, y: 0, width: CELL_PX, height: CELL_PX };
    const sprites = new Map<string, EntitySprite>([
      ["npc-low", mockEntity({ npcId: "npc-low", bounds: box, depth: 1 })],
      ["npc-top", mockEntity({ npcId: "npc-top", bounds: box, depth: 5 })],
    ]);
    expect(hitNpcAtWorldPoint(CELL_PX / 2, CELL_PX / 2, sprites)).toBe("npc-top");
  });

  it("returns null when no NPC hit", () => {
    const box: Rect = { x: 0, y: 0, width: CELL_PX, height: CELL_PX };
    const sprites = new Map<string, EntitySprite>([
      ["npc-a", mockEntity({ npcId: "npc-a", bounds: box })],
    ]);
    expect(hitNpcAtWorldPoint(200, 200, sprites)).toBeNull();
  });
});

describe("npcIdAtGridCell", () => {
  it("returns NPC on matching grid cell", () => {
    const sprites = new Map<string, EntitySprite>([
      ["npc-a", mockEntity({ npcId: "npc-a", bounds: { x: 0, y: 0, width: CELL_PX, height: CELL_PX }, gridX: 3, gridY: 4 })],
    ]);
    expect(npcIdAtGridCell(3, 4, sprites)).toBe("npc-a");
    expect(npcIdAtGridCell(3, 5, sprites)).toBeNull();
  });
});

describe("pickNpcAtWorldPoint", () => {
  it("falls back to grid cell when bounds miss", () => {
    const sprites = new Map<string, EntitySprite>([
      [
        "npc-a",
        mockEntity({
          npcId: "npc-a",
          bounds: { x: 0, y: 0, width: CELL_PX, height: CELL_PX },
          gridX: 2,
          gridY: 2,
        }),
      ],
    ]);
    expect(pickNpcAtWorldPoint(200, 200, 2, 2, sprites)).toBe("npc-a");
  });
});
