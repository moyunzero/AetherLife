import { z } from "zod";

/** e.g. `beginning-fields@v1` */
export type WorldRegionId = `${string}@${string}`;

/** Namespaced zone id: `{regionId}:{localId}` */
export type ZoneId = `${WorldRegionId}:${string}`;

export const BEGINNING_FIELDS_ID = "beginning-fields@v1" as WorldRegionId;
export const VILLAGE_PLAZA_ID = "village-plaza@v1" as WorldRegionId;

const MAX_REGIONS = 16;
const MAX_ZONES_PER_REGION = 64;
const MAX_POIS_PER_REGION = 64;

const AnchorSchema = z
  .object({
    gx: z.number().int(),
    gy: z.number().int(),
  })
  .strict();

const SizeSchema = z
  .object({
    w: z.number().int().min(1).max(512),
    h: z.number().int().min(1).max(512),
  })
  .strict();

const RegionEntrySchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+@v\d+$/),
    labelZh: z.string().min(1).max(32),
    anchor: AnchorSchema,
    size: SizeSchema,
  })
  .strict();

const RegionsFileSchema = z
  .object({
    regions: z.array(RegionEntrySchema).min(1).max(MAX_REGIONS),
  })
  .strict();

const ZoneRectSchema = z
  .object({
    lx: z.number().int().min(0),
    ly: z.number().int().min(0),
    w: z.number().int().min(1),
    h: z.number().int().min(1),
  })
  .strict();

const ZoneEntrySchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    labelZh: z.string().min(1).max(32),
    rect: ZoneRectSchema,
  })
  .strict();

const ZonesFileSchema = z
  .object({
    zones: z.array(ZoneEntrySchema).max(MAX_ZONES_PER_REGION),
  })
  .strict();

const PoiEntrySchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    labelZh: z.string().min(1).max(32),
    lx: z.number().int().min(0),
    ly: z.number().int().min(0),
    kind: z.enum(["home", "work", "social", "landmark"]),
  })
  .strict();

const PoisFileSchema = z
  .object({
    pois: z.array(PoiEntrySchema).max(MAX_POIS_PER_REGION),
  })
  .strict();

const LocalCellSchema = z
  .object({
    lx: z.number().int().min(0),
    ly: z.number().int().min(0),
  })
  .strict();

const CouncilSpawnEntrySchema = z
  .object({
    x: z.number().int().min(0),
    y: z.number().int().min(0),
    facing: z.enum(["n", "s", "e", "w"]),
    maxRadius: z.number().int().min(0).max(64),
  })
  .strict();

const SpawnsFileSchema = z
  .object({
    defaultPlayerSpawn: LocalCellSchema,
    councilSpawns: z.array(CouncilSpawnEntrySchema).length(12).optional(),
  })
  .strict();

export type WorldRegion = {
  id: WorldRegionId;
  labelZh: string;
  anchor: { gx: number; gy: number };
  size: { w: number; h: number };
};

export type ZoneRect = {
  lx: number;
  ly: number;
  w: number;
  h: number;
};

export type Zone = {
  zoneId: ZoneId;
  regionId: WorldRegionId;
  localId: string;
  labelZh: string;
  rect: ZoneRect;
};

export type Poi = {
  poiId: string;
  regionId: WorldRegionId;
  localId: string;
  labelZh: string;
  lx: number;
  ly: number;
  kind: "home" | "work" | "social" | "landmark";
};

export type CouncilSpawnEntry = {
  x: number;
  y: number;
  facing: "n" | "s" | "e" | "w";
  maxRadius: number;
};

export type RegionSpawns = {
  defaultPlayerSpawn: { lx: number; ly: number };
  councilSpawns?: CouncilSpawnEntry[];
};

export type WorldRegistry = {
  regions: WorldRegion[];
  zonesByRegion: Map<WorldRegionId, Zone[]>;
  poisByRegion: Map<WorldRegionId, Poi[]>;
  spawnsByRegion: Map<WorldRegionId, RegionSpawns>;
};

let activeRegistry: WorldRegistry | null = null;

export function getWorldRegistry(): WorldRegistry | null {
  return activeRegistry;
}

export function setWorldRegistry(registry: WorldRegistry | null): void {
  activeRegistry = registry;
}

function ensureRegistry(): WorldRegistry {
  if (!activeRegistry) {
    activeRegistry = loadWorldRegistry(defaultWorldRegistryBundle());
  }
  return activeRegistry;
}

export type WorldRegistryBundle = {
  regions: unknown;
  zonesByRegionId: Record<string, unknown>;
  poisByRegionId?: Record<string, unknown>;
  spawnsByRegionId?: Record<string, unknown>;
};

/** Parse and activate registry from disk-shaped bundle (game-server boot). */
export function loadWorldRegistry(bundle: WorldRegistryBundle): WorldRegistry {
  const regionsParsed = RegionsFileSchema.parse(bundle.regions);
  const regions: WorldRegion[] = regionsParsed.regions.map((r) => ({
    id: r.id as WorldRegionId,
    labelZh: r.labelZh,
    anchor: r.anchor,
    size: r.size,
  }));

  assertRegionsNonOverlapping(regions);

  const zonesByRegion = new Map<WorldRegionId, Zone[]>();
  const allZoneIds = new Set<string>();
  const poisByRegion = new Map<WorldRegionId, Poi[]>();
  const spawnsByRegion = new Map<WorldRegionId, RegionSpawns>();

  for (const region of regions) {
    const zonesRaw = bundle.zonesByRegionId[region.id];
    if (!zonesRaw) {
      throw new Error(`world registry: missing zones for region ${region.id}`);
    }
    const zonesParsed = ZonesFileSchema.parse(zonesRaw);
    const zones: Zone[] = zonesParsed.zones.map((z) => {
      const zoneId = `${region.id}:${z.id}` as ZoneId;
      validateZoneInRegion(region, z.rect);
      return {
        zoneId,
        regionId: region.id,
        localId: z.id,
        labelZh: z.labelZh,
        rect: z.rect,
      };
    });
    zonesByRegion.set(region.id, zones);
    for (const z of zones) {
      allZoneIds.add(z.zoneId);
    }

    const poisRaw = bundle.poisByRegionId?.[region.id];
    if (poisRaw) {
      const poisParsed = PoisFileSchema.parse(poisRaw);
      const pois: Poi[] = poisParsed.pois.map((p) => {
        validateLocalCellInRegion(region, p.lx, p.ly);
        return {
          poiId: `${region.id}:${p.id}`,
          regionId: region.id,
          localId: p.id,
          labelZh: p.labelZh,
          lx: p.lx,
          ly: p.ly,
          kind: p.kind,
        };
      });
      poisByRegion.set(region.id, pois);
    }

    const spawnsRaw = bundle.spawnsByRegionId?.[region.id];
    if (spawnsRaw) {
      const spawnsParsed = SpawnsFileSchema.parse(spawnsRaw);
      validateLocalCellInRegion(
        region,
        spawnsParsed.defaultPlayerSpawn.lx,
        spawnsParsed.defaultPlayerSpawn.ly,
      );
      if (region.id === BEGINNING_FIELDS_ID && !spawnsParsed.councilSpawns) {
        throw new Error(
          `world registry: ${region.id} requires exactly 12 councilSpawns`,
        );
      }
      if (spawnsParsed.councilSpawns) {
        if (region.id === BEGINNING_FIELDS_ID && spawnsParsed.councilSpawns.length !== 12) {
          throw new Error(
            `world registry: ${region.id} requires exactly 12 councilSpawns`,
          );
        }
        for (const slot of spawnsParsed.councilSpawns) {
          validateLocalCellInRegion(region, slot.x, slot.y);
        }
      }
      spawnsByRegion.set(region.id, spawnsParsed);
    }
  }

  const registry: WorldRegistry = {
    regions,
    zonesByRegion,
    poisByRegion,
    spawnsByRegion,
  };
  activeRegistry = registry;
  return registry;
}

/** Boot-time guard: region bounding boxes must not overlap (T-16-11). */
export function assertRegionsNonOverlapping(regions: WorldRegion[]): void {
  for (let i = 0; i < regions.length; i++) {
    const a = regions[i]!;
    const aRight = a.anchor.gx + a.size.w;
    const aBottom = a.anchor.gy + a.size.h;
    for (let j = i + 1; j < regions.length; j++) {
      const b = regions[j]!;
      const bRight = b.anchor.gx + b.size.w;
      const bBottom = b.anchor.gy + b.size.h;
      const overlaps =
        a.anchor.gx < bRight
        && aRight > b.anchor.gx
        && a.anchor.gy < bBottom
        && aBottom > b.anchor.gy;
      if (overlaps) {
        throw new Error(
          `world registry: regions ${a.id} and ${b.id} overlap in global grid`,
        );
      }
    }
  }
}

function validateZoneInRegion(region: WorldRegion, rect: ZoneRect): void {
  if (rect.lx + rect.w > region.size.w || rect.ly + rect.h > region.size.h) {
    throw new Error(`world registry: zone rect out of bounds for ${region.id}`);
  }
}

function validateLocalCellInRegion(region: WorldRegion, lx: number, ly: number): void {
  if (lx < 0 || ly < 0 || lx >= region.size.w || ly >= region.size.h) {
    throw new Error(`world registry: local cell out of bounds for ${region.id}`);
  }
}

export function parseZoneId(zoneId: ZoneId): { regionId: WorldRegionId; localId: string } {
  const idx = zoneId.lastIndexOf(":");
  if (idx <= 0 || idx === zoneId.length - 1) {
    throw new Error(`invalid zoneId: ${zoneId}`);
  }
  const regionId = zoneId.slice(0, idx) as WorldRegionId;
  const localId = zoneId.slice(idx + 1);
  if (!regionId.includes("@")) {
    throw new Error(`invalid zoneId region: ${zoneId}`);
  }
  return { regionId, localId };
}

export function toGlobal(
  region: WorldRegion,
  lx: number,
  ly: number,
): { gx: number; gy: number } {
  return { gx: region.anchor.gx + lx, gy: region.anchor.gy + ly };
}

export function fromLocal(
  region: WorldRegion,
  gx: number,
  gy: number,
): { lx: number; ly: number } | null {
  const lx = gx - region.anchor.gx;
  const ly = gy - region.anchor.gy;
  if (lx < 0 || ly < 0 || lx >= region.size.w || ly >= region.size.h) {
    return null;
  }
  return { lx, ly };
}

export function regionAt(gx: number, gy: number): WorldRegion | null {
  const registry = ensureRegistry();
  for (const region of registry.regions) {
    const lx = gx - region.anchor.gx;
    const ly = gy - region.anchor.gy;
    if (lx >= 0 && ly >= 0 && lx < region.size.w && ly < region.size.h) {
      return region;
    }
  }
  return null;
}

export function zoneAtLocal(
  regionId: WorldRegionId,
  lx: number,
  ly: number,
): Zone | null {
  const registry = ensureRegistry();
  const zones = registry.zonesByRegion.get(regionId);
  if (!zones) return null;
  for (const zone of zones) {
    const { rect } = zone;
    if (
      lx >= rect.lx &&
      ly >= rect.ly &&
      lx < rect.lx + rect.w &&
      ly < rect.ly + rect.h
    ) {
      return zone;
    }
  }
  return null;
}

export function getRegionById(id: WorldRegionId): WorldRegion | undefined {
  return ensureRegistry().regions.find((r) => r.id === id);
}

/** Default bundle aligned with apps/game-server/data/world/ (tests + lazy init). */
export function defaultBeginningFieldsBundle(): WorldRegistryBundle {
  return {
    regions: {
      regions: [
        {
          id: BEGINNING_FIELDS_ID,
          labelZh: "起始田野",
          anchor: { gx: 0, gy: 0 },
          size: { w: 40, h: 40 },
        },
      ],
    },
    zonesByRegionId: {
      [BEGINNING_FIELDS_ID]: {
        zones: [
          { id: "orchard", labelZh: "果园", rect: { lx: 18, ly: 6, w: 12, h: 10 } },
          { id: "plaza", labelZh: "村口广场", rect: { lx: 28, ly: 8, w: 12, h: 12 } },
          { id: "pond", labelZh: "池塘", rect: { lx: 22, ly: 22, w: 14, h: 12 } },
        ],
      },
    },
    poisByRegionId: {
      [BEGINNING_FIELDS_ID]: {
        pois: [
          { id: "well", labelZh: "水井", lx: 34, ly: 13, kind: "social" },
          { id: "npc-1-home", labelZh: "学者小屋", lx: 23, ly: 10, kind: "home" },
          { id: "npc-2-home", labelZh: "工匠棚", lx: 9, ly: 21, kind: "home" },
          { id: "npc-3-home", labelZh: "湖畔小屋", lx: 28, ly: 27, kind: "home" },
        ],
      },
    },
    spawnsByRegionId: {
      [BEGINNING_FIELDS_ID]: {
        defaultPlayerSpawn: { lx: 34, ly: 13 },
        councilSpawns: [
          { x: 9, y: 21, facing: "s", maxRadius: 40 },
          { x: 9, y: 5, facing: "s", maxRadius: 40 },
          { x: 23, y: 11, facing: "e", maxRadius: 40 },
          { x: 31, y: 13, facing: "w", maxRadius: 40 },
          { x: 17, y: 13, facing: "e", maxRadius: 40 },
          { x: 33, y: 28, facing: "n", maxRadius: 40 },
          { x: 20, y: 26, facing: "s", maxRadius: 40 },
          { x: 16, y: 31, facing: "n", maxRadius: 40 },
          { x: 27, y: 27, facing: "w", maxRadius: 40 },
          { x: 29, y: 17, facing: "s", maxRadius: 40 },
          { x: 5, y: 9, facing: "e", maxRadius: 40 },
          { x: 17, y: 22, facing: "s", maxRadius: 40 },
        ],
      },
    },
  };
}

/** Full two-region bundle aligned with apps/game-server/data/world/ (web lazy init + tests). */
export function defaultWorldRegistryBundle(): WorldRegistryBundle {
  const bf = defaultBeginningFieldsBundle();
  return {
    regions: {
      regions: [
        ...(bf.regions as { regions: WorldRegion[] }).regions,
        {
          id: VILLAGE_PLAZA_ID,
          labelZh: "村内广场",
          anchor: { gx: 40, gy: 0 },
          size: { w: 20, h: 40 },
        },
      ],
    },
    zonesByRegionId: {
      ...bf.zonesByRegionId,
      [VILLAGE_PLAZA_ID]: {
        zones: [
          { id: "plaza", labelZh: "村内广场", rect: { lx: 2, ly: 8, w: 16, h: 24 } },
          { id: "market", labelZh: "集市侧廊", rect: { lx: 10, ly: 14, w: 8, h: 10 } },
        ],
      },
    },
    poisByRegionId: {
      ...bf.poisByRegionId,
      [VILLAGE_PLAZA_ID]: {
        pois: [
          { id: "fountain", labelZh: "村长雕像", lx: 10, ly: 10, kind: "social" },
          { id: "notice-board", labelZh: "公告板", lx: 14, ly: 18, kind: "landmark" },
        ],
      },
    },
    spawnsByRegionId: {
      ...bf.spawnsByRegionId,
      [VILLAGE_PLAZA_ID]: {
        defaultPlayerSpawn: { lx: 10, ly: 20 },
      },
    },
  };
}
