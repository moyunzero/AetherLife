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

  it("default bg npc spawns are walkable (sync spawns.json after bake:one-city)", () => {
    expect(isTerrainWalkableInRegion(33, 11)).toBe(true);
    expect(isTerrainWalkableInRegion(30, 15)).toBe(true);
    expect(isTerrainWalkableInRegion(19, 12)).toBe(true);
    expect(isTerrainWalkableInRegion(25, 25)).toBe(true);
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
