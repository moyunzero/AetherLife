import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BEGINNING_FIELDS_ID,
  VILLAGE_PLAZA_ID,
  defaultBeginningFieldsBundle,
  defaultWorldRegistryBundle,
  loadWorldRegistry,
} from "@aetherlife/shared";
import bfCollisionFixture from "../../data/world/beginning-fields@v1/collision.json";
import plazaCollisionFixture from "../../data/world/village-plaza@v1/collision.json";
import {
  bootBeginningFieldsCollision,
  isTerrainWalkableInRegion,
  registerRegionCollision,
  resetRegionWalkabilityForTests,
} from "./region-walkability.js";

describe("region-walkability", () => {
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

  it("returns undefined outside registered regions", () => {
    expect(isTerrainWalkableInRegion(80, 80)).toBeUndefined();
  });

  it("blocks a painted Collision layer cell inside beginning-fields", () => {
    // Tiled Collision layer (gid 5839) at plaza north edge — sync with bake:one-city.
    expect(isTerrainWalkableInRegion(28, 8)).toBe(false);
  });

  it("allows default player spawn on grass terrain", () => {
    expect(isTerrainWalkableInRegion(34, 13)).toBe(true);
  });

  it("all 12 council embassy spawns are walkable (sync spawns.json after bake:one-city)", () => {
    const spawns = loadWorldRegistry(defaultBeginningFieldsBundle()).spawnsByRegion.get(
      BEGINNING_FIELDS_ID,
    );
    expect(spawns?.councilSpawns).toHaveLength(12);
    for (const slot of spawns!.councilSpawns!) {
      expect(isTerrainWalkableInRegion(slot.x, slot.y)).toBe(true);
    }
  });

  it("council embassy spawns do not overlap player default spawn or each other", () => {
    const spawns = loadWorldRegistry(defaultBeginningFieldsBundle()).spawnsByRegion.get(
      BEGINNING_FIELDS_ID,
    );
    const player = spawns!.defaultPlayerSpawn!;
    const council = spawns!.councilSpawns!;
    for (const slot of council) {
      const onPlayerSpawn = slot.x === player.lx && slot.y === player.ly;
      expect(onPlayerSpawn).toBe(false);
    }
    for (let i = 0; i < council.length; i += 1) {
      for (let j = i + 1; j < council.length; j += 1) {
        const a = council[i]!;
        const b = council[j]!;
        const sameCell = a.x === b.x && a.y === b.y;
        expect(sameCell).toBe(false);
      }
    }
    const minDistFromPlayer = Math.min(
      ...council.map((s) => Math.max(Math.abs(s.x - player.lx), Math.abs(s.y - player.ly))),
    );
    expect(minDistFromPlayer).toBeGreaterThanOrEqual(3);
  });

  it("council spawns spread across full homestead (user-picked layout)", () => {
    const spawns = loadWorldRegistry(defaultBeginningFieldsBundle()).spawnsByRegion.get(
      BEGINNING_FIELDS_ID,
    );
    const council = spawns!.councilSpawns!;
    const xs = council.map((s) => s.x);
    const ys = council.map((s) => s.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThanOrEqual(20);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThanOrEqual(20);
  });

  it("council spawns stay on walkable homestead cells with min separation", () => {
    const spawns = loadWorldRegistry(defaultBeginningFieldsBundle()).spawnsByRegion.get(
      BEGINNING_FIELDS_ID,
    );
    const council = spawns!.councilSpawns!;
    const HOMESTEAD = { minX: 5, minY: 5, maxX: 33, maxY: 31 };
    for (const slot of council) {
      expect(slot.x).toBeGreaterThanOrEqual(HOMESTEAD.minX);
      expect(slot.x).toBeLessThanOrEqual(HOMESTEAD.maxX);
      expect(slot.y).toBeGreaterThanOrEqual(HOMESTEAD.minY);
      expect(slot.y).toBeLessThanOrEqual(HOMESTEAD.maxY);
      expect(isTerrainWalkableInRegion(slot.x, slot.y)).toBe(true);
    }
    for (let i = 0; i < council.length; i += 1) {
      for (let j = i + 1; j < council.length; j += 1) {
        const a = council[i]!;
        const b = council[j]!;
        const chebyshev = Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
        expect(chebyshev).toBeGreaterThanOrEqual(3);
      }
    }
    const xs = council.map((s) => s.x);
    const ys = council.map((s) => s.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThanOrEqual(20);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThanOrEqual(20);
  });

  it("rejects mismatched grid size at boot", () => {
    expect(() =>
      registerRegionCollision(BEGINNING_FIELDS_ID, {
        width: 2,
        height: 2,
        cells: [0],
      }),
    ).toThrow(/cells\.length/);
  });

  it("rejects collision grid dimensions that disagree with registry size (T-16-09)", () => {
    expect(() =>
      registerRegionCollision(
        BEGINNING_FIELDS_ID,
        {
          width: 40,
          height: 40,
          cells: new Array(1600).fill(0),
        },
        { w: 39, h: 40 },
      ),
    ).toThrow(/dimensions.*registry/);
  });

  describe("multi-region (Wave 4)", () => {
    beforeEach(() => {
      resetRegionWalkabilityForTests();
      loadWorldRegistry(defaultWorldRegistryBundle());
      registerRegionCollision(BEGINNING_FIELDS_ID, bfCollisionFixture as {
        width: number;
        height: number;
        cells: number[];
      });
      registerRegionCollision(VILLAGE_PLAZA_ID, plazaCollisionFixture as {
        width: number;
        height: number;
        cells: number[];
      });
    });

    it("陆桥 cells (39,20) and (40,20) both walkable", () => {
      expect(isTerrainWalkableInRegion(39, 20)).toBe(true);
      expect(isTerrainWalkableInRegion(40, 20)).toBe(true);
    });
  });
});
