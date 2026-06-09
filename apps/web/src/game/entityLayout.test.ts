import { describe, expect, it } from "vitest";
import {
  ENTITY_DEPTH_BASE,
  entityFootSortPoint,
  entityYSortDepth,
  entityYSortDepthFromCenter,
  tiledObjectYSortDepth,
  ySortDepth,
  YSORT_LAYER,
} from "./entityLayout.js";
import { CELL_PX } from "./gridLayout.js";

const FLOOR_DEPTH_MAX = 2;

describe("ySortDepth", () => {
  it("orders south foot points in front of north (Tiled topdown)", () => {
    expect(ySortDepth(0, 100)).toBeLessThan(ySortDepth(0, 200));
  });

  it("breaks same-row ties by X without flipping Y order", () => {
    const y = 480;
    expect(ySortDepth(0, y)).toBeLessThan(ySortDepth(CELL_PX, y));
    expect(ySortDepth(0, y)).toBeLessThan(ySortDepth(0, y + CELL_PX));
  });
});

describe("entityYSortDepth", () => {
  it("stays above floor layers when gy is negative (explore north)", () => {
    const d = entityYSortDepth(5, -11, YSORT_LAYER.PLAYER);
    expect(d).toBeGreaterThan(FLOOR_DEPTH_MAX);
    const foot = entityFootSortPoint(5, -11);
    expect(d).toBe(ySortDepth(foot.x, foot.y, YSORT_LAYER.PLAYER));
  });

  it("preserves y-sort ordering for two cells in the same column", () => {
    expect(entityYSortDepth(3, 4, 1)).toBeLessThan(entityYSortDepth(3, 5, 1));
  });

  it("renders entities above foot-aligned decor on the same cell", () => {
    expect(entityYSortDepth(4, 6, YSORT_LAYER.DECOR)).toBeLessThan(
      entityYSortDepth(4, 6, YSORT_LAYER.NPC),
    );
  });

  it("matches live container center during movement tween", () => {
    const gx = 7;
    const gy = 3;
    const centerX = gx * CELL_PX + CELL_PX / 2;
    const centerY = gy * CELL_PX + CELL_PX / 2;
    expect(entityYSortDepthFromCenter(centerX, centerY, YSORT_LAYER.PLAYER)).toBe(
      entityYSortDepth(gx, gy, YSORT_LAYER.PLAYER),
    );
  });
});

describe("tiledObjectYSortDepth", () => {
  it("orders north Tiled objects behind south (topdown)", () => {
    const northY = 154 * 3;
    const southY = 330 * 3;
    expect(tiledObjectYSortDepth(0, northY)).toBeLessThan(tiledObjectYSortDepth(0, southY));
  });

  it("interleaves with grid entities on shared foot Y", () => {
    const gy = 20;
    const foot = entityFootSortPoint(10, gy);
    const entity = entityYSortDepth(10, gy, YSORT_LAYER.NPC);
    const propSouth = tiledObjectYSortDepth(foot.x, foot.y + CELL_PX, YSORT_LAYER.OBJECT);
    expect(entity).toBeLessThan(propSouth);
  });

  it("uses same formula as entity foot at aligned Tiled bottom-left", () => {
    const gy = 12;
    const foot = entityFootSortPoint(8, gy);
    const tiledAtFoot = tiledObjectYSortDepth(foot.x - CELL_PX / 2, foot.y, YSORT_LAYER.OBJECT);
    expect(tiledAtFoot).toBeLessThan(entityYSortDepth(8, gy, YSORT_LAYER.NPC));
    expect(entityYSortDepth(8, gy, YSORT_LAYER.NPC)).toBeLessThan(
      tiledObjectYSortDepth(foot.x + CELL_PX / 2, foot.y, YSORT_LAYER.OBJECT),
    );
  });

  it("keeps ENTITY_DEPTH_BASE as documented baseline", () => {
    expect(ySortDepth(0, 0, 0)).toBe(ENTITY_DEPTH_BASE);
  });
});
