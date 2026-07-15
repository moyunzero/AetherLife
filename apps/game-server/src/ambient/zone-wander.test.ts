import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildGlobalMoveGrid,
  defaultBeginningFieldsBundle,
  loadWorldRegistry,
  stableStringHash,
  type NpcState,
} from "@aetherlife/shared";
import { createDefaultRoom } from "@aetherlife/shared";
import collisionFixture from "../../data/world/beginning-fields@v1/collision.json";
import type { ScheduleSegment } from "./schedule.js";
import { bootBeginningFieldsCollision, regionWalkabilityAt } from "../world/region-walkability.js";
import { pickZoneTarget, LINGER_RADIUS, LINGER_PAUSE_PERCENT, MAX_ZONE_SAMPLE_CELLS, PERSONAL_SPACE, pickSpaciousCell, shouldSampleZoneCell } from "./zone-wander.js";

function lingerActiveMinute(npcId: string): number {
  for (let m = 0; m < 1440; m++) {
    if (stableStringHash(`linger:${npcId}:${m}`) % 100 >= LINGER_PAUSE_PERCENT) return m;
  }
  return 0;
}

function openGrid() {
  const map = createDefaultRoom("zone-wander-test");
  return buildGlobalMoveGrid({
    homeMap: map,
    otherPlayerCells: [],
    isTerrainWalkable: () => true,
  });
}

function collisionGrid() {
  const map = createDefaultRoom("zone-wander-collision");
  return buildGlobalMoveGrid({
    homeMap: map,
    otherPlayerCells: [],
    isTerrainWalkable: (gx, gy) => regionWalkabilityAt(gx, gy) !== false,
  });
}

describe("pickZoneTarget", () => {
  beforeEach(() => {
    loadWorldRegistry(defaultBeginningFieldsBundle());
    bootBeginningFieldsCollision(collisionFixture as {
      width: number;
      height: number;
      cells: number[];
    });
    vi.spyOn(Math, "random").mockReturnValue(0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("LINGER_PAUSE_PERCENT is 15 (D-09 MAP-06)", () => {
    expect(LINGER_PAUSE_PERCENT).toBe(15);
  });

  it("returns cell inside zone rect bounds", () => {
    const map = createDefaultRoom("zone-bounds");
    const npc = map.npcs[0] as NpcState;
    const segment: ScheduleSegment = {
      fromMinute: 480,
      toMinute: 720,
      activityKey: "patrol",
      zoneId: "beginning-fields@v1:orchard",
      mobility: "wander",
    };
    const { targetGx, targetGy } = pickZoneTarget({
      npc,
      segment,
      grid: openGrid(),
      playerCells: [],
      recentCells: [],
      gameMinute: 500,
    });
    expect(targetGx).toBeGreaterThanOrEqual(18);
    expect(targetGx).toBeLessThan(30);
    expect(targetGy).toBeGreaterThanOrEqual(6);
    expect(targetGy).toBeLessThan(16);
  });

  it("poi mobility targets social POI (well)", () => {
    const map = createDefaultRoom("zone-poi");
    const npc = map.npcs[2] as NpcState;
    const segment: ScheduleSegment = {
      fromMinute: 540,
      toMinute: 900,
      activityKey: "socializing",
      zoneId: "beginning-fields@v1:plaza",
      mobility: "poi",
    };
    const { targetGx, targetGy } = pickZoneTarget({
      npc,
      segment,
      grid: openGrid(),
      playerCells: [],
      recentCells: [],
      gameMinute: 500,
    });
    expect(targetGx).toBe(34);
    expect(targetGy).toBe(13);
  });

  it("D-social-mvp biases toward cells adjacent to player when wandering socialize", () => {
    const map = createDefaultRoom("zone-social");
    const npc = map.npcs[0] as NpcState;
    npc.x = 30;
    npc.y = 12;
    const segment: ScheduleSegment = {
      fromMinute: 720,
      toMinute: 1080,
      activityKey: "socializing",
      zoneId: "beginning-fields@v1:plaza",
      mobility: "wander",
    };
    const { targetGx, targetGy } = pickZoneTarget({
      npc,
      segment,
      grid: openGrid(),
      playerCells: [{ x: 31, y: 12 }],
      recentCells: [],
      gameMinute: 800,
    });
    expect(Math.max(Math.abs(targetGx - 31), Math.abs(targetGy - 12))).toBe(1);
  });

  it("never picks collision-blocked water cells when wandering orchard", () => {
    const map = createDefaultRoom("zone-collision");
    const npc = map.npcs[0] as NpcState;
    npc.x = 23;
    npc.y = 10;
    const segment: ScheduleSegment = {
      fromMinute: 480,
      toMinute: 720,
      activityKey: "patrol",
      zoneId: "beginning-fields@v1:orchard",
      mobility: "wander",
    };
    for (let i = 0; i < 20; i++) {
      vi.spyOn(Math, "random").mockReturnValue((i * 0.037) % 1);
      const { targetGx, targetGy } = pickZoneTarget({
        npc,
        segment,
        grid: collisionGrid(),
        playerCells: [],
        recentCells: [],
        gameMinute: 500 + i,
      });
      expect(regionWalkabilityAt(targetGx, targetGy)).not.toBe(false);
    }
  });

  it("stationary mobility picks target within linger radius when not pausing", () => {
    const map = createDefaultRoom("zone-linger");
    const npc = map.npcs[0] as NpcState;
    npc.x = 23;
    npc.y = 10;
    const segment: ScheduleSegment = {
      fromMinute: 360,
      toMinute: 480,
      activityKey: "reading",
      zoneId: "beginning-fields@v1:orchard",
      mobility: "stationary",
    };
    const gameMinute = lingerActiveMinute(npc.id);
    const { targetGx, targetGy } = pickZoneTarget({
      npc,
      segment,
      grid: openGrid(),
      playerCells: [],
      recentCells: [],
      gameMinute,
    });
    expect(Math.max(Math.abs(targetGx - npc.x), Math.abs(targetGy - npc.y))).toBeLessThanOrEqual(
      LINGER_RADIUS,
    );
    expect(targetGx !== npc.x || targetGy !== npc.y).toBe(true);
  });

  it("malformed zoneId falls back to npc position without throwing", () => {
    const map = createDefaultRoom("zone-malformed");
    const npc = map.npcs[0] as NpcState;
    npc.x = 12;
    npc.y = 8;
    const segment: ScheduleSegment = {
      fromMinute: 0,
      toMinute: 1440,
      activityKey: "patrol",
      zoneId: "village-square@v1",
      mobility: "wander",
    };
    const { targetGx, targetGy } = pickZoneTarget({
      npc,
      segment,
      grid: openGrid(),
      playerCells: [],
      recentCells: [],
      gameMinute: 0,
    });
    expect(targetGx).toBe(npc.x);
    expect(targetGy).toBe(npc.y);
  });

  it("stationary outside zone commutes to nearest zone cell", () => {
    const map = createDefaultRoom("zone-commute");
    const npc = map.npcs[0] as NpcState;
    npc.x = 5;
    npc.y = 5;
    const segment: ScheduleSegment = {
      fromMinute: 360,
      toMinute: 480,
      activityKey: "reading",
      zoneId: "beginning-fields@v1:orchard",
      mobility: "stationary",
    };
    const gameMinute = lingerActiveMinute(npc.id);
    const { targetGx, targetGy } = pickZoneTarget({
      npc,
      segment,
      grid: openGrid(),
      playerCells: [],
      recentCells: [],
      gameMinute,
    });
    expect(targetGx).toBeGreaterThanOrEqual(18);
    expect(targetGx).toBeLessThan(30);
    expect(targetGy).toBeGreaterThanOrEqual(6);
    expect(targetGy).toBeLessThan(16);
    expect(Math.max(Math.abs(targetGx - npc.x), Math.abs(targetGy - npc.y))).toBeGreaterThan(
      LINGER_RADIUS,
    );
  });

  it("never picks an occupied cell when a free alternative exists", () => {
    const map = createDefaultRoom("zone-nostack");
    const npc = map.npcs[0] as NpcState;
    npc.x = 24;
    npc.y = 10;
    const segment: ScheduleSegment = {
      fromMinute: 480,
      toMinute: 720,
      activityKey: "patrol",
      zoneId: "beginning-fields@v1:orchard",
      mobility: "wander",
    };
    const occupied = [
      { x: 18, y: 6 },
      { x: 19, y: 6 },
      { x: 20, y: 6 },
    ];
    for (let i = 0; i < 15; i++) {
      vi.spyOn(Math, "random").mockReturnValue((i * 0.11) % 1);
      const { targetGx, targetGy } = pickZoneTarget({
        npc,
        segment,
        grid: openGrid(),
        playerCells: [],
        recentCells: [],
        gameMinute: 500 + i,
        occupiedCells: occupied,
      });
      expect(occupied.some((o) => o.x === targetGx && o.y === targetGy)).toBe(false);
    }
  });

  it("pickSpaciousCell prefers PERSONAL_SPACE clearance", () => {
    const pool = [
      { x: 10, y: 10 },
      { x: 11, y: 10 },
      { x: 20, y: 20 },
    ];
    const occupied = [{ x: 10, y: 10 }];
    const chosen = pickSpaciousCell(pool, occupied, []);
    expect(chosen).toEqual({ x: 20, y: 20 });
    expect(Math.max(Math.abs(chosen!.x - 10), Math.abs(chosen!.y - 10))).toBeGreaterThanOrEqual(
      PERSONAL_SPACE,
    );
  });
});

describe("shouldSampleZoneCell (T-16-02)", () => {
  it("samples every cell when zone area <= MAX_ZONE_SAMPLE_CELLS", () => {
    const rect = { w: 16, h: 16 };
    let sampled = 0;
    for (let lx = 0; lx < rect.w; lx++) {
      for (let ly = 0; ly < rect.h; ly++) {
        if (shouldSampleZoneCell("beginning-fields@v1:small", lx, ly, rect)) sampled++;
      }
    }
    expect(sampled).toBe(rect.w * rect.h);
  });

  it("subsamples huge zones to roughly MAX_ZONE_SAMPLE_CELLS", () => {
    const rect = { w: 128, h: 128 };
    let sampled = 0;
    for (let lx = 0; lx < rect.w; lx++) {
      for (let ly = 0; ly < rect.h; ly++) {
        if (shouldSampleZoneCell("beginning-fields@v1:huge", lx, ly, rect)) sampled++;
      }
    }
    expect(sampled).toBeGreaterThan(0);
    expect(sampled).toBeLessThanOrEqual(MAX_ZONE_SAMPLE_CELLS + 50);
  });
});
