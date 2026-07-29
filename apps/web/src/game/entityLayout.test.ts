import { describe, expect, it } from "vitest";
import {
  ENTITY_DEPTH_BASE,
  entityFootSortPoint,
  entityYSortDepth,
  entityYSortDepthFromCenter,
  MAP_TILE_DEPTH_BASE,
  MAP_TILE_DEPTH_STEP,
  clusterSouthSortWorldY,
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

describe("clusterSouthSortWorldY", () => {
  it("raises northern Campfire tiles to the cluster south edge", () => {
    // Real home Campfire bottoms (TILE_SCALE=2): y=480→960, y=496→992
    const parts = [
      { bottomWorldX: 512, bottomWorldY: 960 },
      { bottomWorldX: 544, bottomWorldY: 960 },
      { bottomWorldX: 512, bottomWorldY: 992 },
      { bottomWorldX: 544, bottomWorldY: 992 },
    ];
    const sortYs = clusterSouthSortWorldY(parts);
    expect(sortYs).toEqual([992, 992, 992, 992]);

    const flameDepth = tiledObjectYSortDepth(512, sortYs[0]!, YSORT_LAYER.OBJECT);
    // Player standing on north footprint (gy=29 → foot row 30) must stay behind flames.
    expect(entityYSortDepth(16, 29, YSORT_LAYER.PLAYER)).toBeLessThan(flameDepth);
  });

  it("keeps separate volumes with different south edges independent", () => {
    const parts = [
      { bottomWorldX: 0, bottomWorldY: 100 },
      { bottomWorldX: 0, bottomWorldY: 132 },
      { bottomWorldX: 400, bottomWorldY: 200 },
      { bottomWorldX: 400, bottomWorldY: 232 },
    ];
    const sortYs = clusterSouthSortWorldY(parts);
    expect(sortYs).toEqual([132, 132, 232, 232]);
  });
});

describe("MAP tile depth bands", () => {
  it("keeps tile + object-shadow bands below entity Y-sort", () => {
    const objectShadowBand = MAP_TILE_DEPTH_BASE + 4 * MAP_TILE_DEPTH_STEP;
    expect(objectShadowBand).toBeLessThan(ENTITY_DEPTH_BASE);
  });
});
