import { describe, expect, it, beforeEach } from "vitest";
import {
  assertRegionsNonOverlapping,
  BEGINNING_FIELDS_ID,
  VILLAGE_PLAZA_ID,
  defaultBeginningFieldsBundle,
  defaultWorldRegistryBundle,
  fromLocal,
  loadWorldRegistry,
  parseZoneId,
  regionAt,
  setWorldRegistry,
  toGlobal,
  type WorldRegion,
  type ZoneId,
} from "./worldRegion.js";

describe("worldRegion", () => {
  beforeEach(() => {
    setWorldRegistry(null);
  });

  it("regionAt(0,0) returns beginning-fields@v1", () => {
    loadWorldRegistry(defaultBeginningFieldsBundle());
    const region = regionAt(0, 0);
    expect(region?.id).toBe(BEGINNING_FIELDS_ID);
    expect(region?.labelZh).toBe("起始田野");
  });

  it("regionAt(39,39) in bounds", () => {
    loadWorldRegistry(defaultBeginningFieldsBundle());
    expect(regionAt(39, 39)?.id).toBe(BEGINNING_FIELDS_ID);
  });

  it("regionAt(40,0) null with single-region bundle", () => {
    loadWorldRegistry(defaultBeginningFieldsBundle());
    expect(regionAt(40, 0)).toBeNull();
  });

  it("regionAt(40,20) returns village-plaza@v1 with world bundle", () => {
    loadWorldRegistry(defaultWorldRegistryBundle());
    const region = regionAt(40, 20);
    expect(region?.id).toBe(VILLAGE_PLAZA_ID);
    expect(region?.labelZh).toBe("村内广场");
  });

  it("parseZoneId village-plaza@v1:plaza", () => {
    const zoneId = "village-plaza@v1:plaza" as ZoneId;
    expect(parseZoneId(zoneId)).toEqual({
      regionId: VILLAGE_PLAZA_ID,
      localId: "plaza",
    });
  });

  it("parseZoneId splits region + localId", () => {
    const zoneId = "beginning-fields@v1:orchard" as ZoneId;
    expect(parseZoneId(zoneId)).toEqual({
      regionId: BEGINNING_FIELDS_ID,
      localId: "orchard",
    });
  });

  it("toGlobal/fromLocal round-trip for anchor (0,0) size 40×40", () => {
    loadWorldRegistry(defaultBeginningFieldsBundle());
    const region = regionAt(0, 0)!;
    const { gx, gy } = toGlobal(region, 15, 20);
    expect(gx).toBe(15);
    expect(gy).toBe(20);
    expect(fromLocal(region, gx, gy)).toEqual({ lx: 15, ly: 20 });
  });

  it("assertRegionsNonOverlapping throws when bounding boxes overlap", () => {
    const a: WorldRegion = {
      id: BEGINNING_FIELDS_ID,
      labelZh: "A",
      anchor: { gx: 0, gy: 0 },
      size: { w: 40, h: 40 },
    };
    const b: WorldRegion = {
      id: VILLAGE_PLAZA_ID,
      labelZh: "B",
      anchor: { gx: 20, gy: 0 },
      size: { w: 20, h: 40 },
    };
    expect(() => assertRegionsNonOverlapping([a, b])).toThrow(/overlap/);
  });

  it("loadWorldRegistry throws when regions overlap", () => {
    const bundle = defaultWorldRegistryBundle();
    const regions = bundle.regions as {
      regions: Array<{ id: string; anchor: { gx: number; gy: number } }>;
    };
    regions.regions[1]!.anchor.gx = 20;
    expect(() => loadWorldRegistry(bundle)).toThrow(/overlap/);
  });

  it("loadWorldRegistry throws on invalid JSON (max zones cap)", () => {
    const bundle = defaultBeginningFieldsBundle();
    const zones = bundle.zonesByRegionId[BEGINNING_FIELDS_ID] as {
      zones: unknown[];
    };
    zones.zones = Array.from({ length: 65 }, (_, i) => ({
      id: `zone-${i}`,
      labelZh: "测试",
      rect: { lx: 0, ly: 0, w: 1, h: 1 },
    }));
    expect(() => loadWorldRegistry(bundle)).toThrow();
  });
});
