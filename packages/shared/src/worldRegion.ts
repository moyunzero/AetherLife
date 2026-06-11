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

const BackgroundNpcSpawnEntrySchema = z
  .object({
    id: z.string().regex(/^bg-villager-[1-4]$/),
    lx: z.number().int().min(0),
    ly: z.number().int().min(0),
    displayNameZh: z.string().min(1).max(16),
    wanderZoneId: z.string().min(1),
    activityKey: z.string().optional(),
  })
  .strict();

const SpawnsFileSchema = z
  .object({
    defaultPlayerSpawn: LocalCellSchema,
    npcSpawns: z.record(z.string(), LocalCellSchema),
    backgroundNpc: z.array(BackgroundNpcSpawnEntrySchema).max(4).optional(),
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

export type RegionSpawns = {
  defaultPlayerSpawn: { lx: number; ly: number };
  npcSpawns: Record<string, { lx: number; ly: number }>;
  backgroundNpc?: Array<{
    id: string;
    lx: number;
    ly: number;
    displayNameZh: string;
    wanderZoneId: string;
    activityKey?: string;
  }>;
};

export type WorldRegistry = {
  regions: WorldRegion[];
  zonesByRegion: Map<WorldRegionId, Zone[]>;
  poisByRegion: Map<WorldRegionId, Poi[]>;
  spawnsByRegion: Map<WorldRegionId, RegionSpawns>;
};

let activeRegistry: WorldRegistry | null = null;

/**
 * Return the currently active world registry or null when no registry is set.
 *
 * @returns `WorldRegistry` if one is active, `null` otherwise.
 */
export function getWorldRegistry(): WorldRegistry | null {
  return activeRegistry;
}

/**
 * Sets the module's active world registry.
 *
 * @param registry - The WorldRegistry to activate, or `null` to clear the active registry
 */
export function setWorldRegistry(registry: WorldRegistry | null): void {
  activeRegistry = registry;
}

/**
 * Ensure a world registry is loaded, initializing it from the default bundle if absent.
 *
 * @returns The active `WorldRegistry`
 */
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

/**
 * Parse the provided disk-shaped bundle, validate its contents, build a WorldRegistry, and activate it as the current registry.
 *
 * Validations include region overlap checks, schema conformance for regions/zones/POIs/spawns, spatial bounds for zones/POIs/spawns, NPC spawn key format, and that background NPC wanderZoneId values reference existing zone IDs.
 *
 * @param bundle - The raw WorldRegistryBundle read from disk (regions, per-region zones, optional POIs, and optional spawns)
 * @returns The constructed and activated WorldRegistry
 * @throws Error if schema validation fails or if the bundle contains inconsistent or out-of-bounds data (e.g., missing zones for a region, overlapping regions, zone/POI/spawn coordinates outside their region, invalid npc spawn keys, or background NPCs referencing unknown zone IDs)
 */
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
      for (const [npcId, cell] of Object.entries(spawnsParsed.npcSpawns)) {
        validateLocalCellInRegion(region, cell.lx, cell.ly);
        if (!npcId.match(/^npc-\d+$/)) {
          throw new Error(`world registry: invalid npc spawn key ${npcId}`);
        }
      }
      if (spawnsParsed.backgroundNpc) {
        for (const bg of spawnsParsed.backgroundNpc) {
          validateLocalCellInRegion(region, bg.lx, bg.ly);
          if (!allZoneIds.has(bg.wanderZoneId)) {
            throw new Error(
              `world registry: backgroundNpc ${bg.id} references unknown zoneId ${bg.wanderZoneId}`,
            );
          }
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

/**
 * Ensures no two regions' axis-aligned bounding boxes overlap in the global grid.
 *
 * @param regions - The list of regions to validate
 * @throws Error if any pair of regions overlap (message: `world registry: regions {idA} and {idB} overlap in global grid`)
 */
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

/**
 * Ensures a zone rectangle fits within a region's size.
 *
 * @param region - The region whose bounds are used for validation.
 * @param rect - The zone rectangle in region-local coordinates.
 * @throws Error if the rectangle extends beyond the region's width or height.
 */
function validateZoneInRegion(region: WorldRegion, rect: ZoneRect): void {
  if (rect.lx + rect.w > region.size.w || rect.ly + rect.h > region.size.h) {
    throw new Error(`world registry: zone rect out of bounds for ${region.id}`);
  }
}

/**
 * Validates that a local cell coordinate lies within a region's bounds.
 *
 * @param region - The region whose local coordinate space is used for bounds.
 * @param lx - Local x cell coordinate (0-based).
 * @param ly - Local y cell coordinate (0-based).
 * @throws Error if `lx` is < 0 or >= `region.size.w`, or if `ly` is < 0 or >= `region.size.h`.
 */
function validateLocalCellInRegion(region: WorldRegion, lx: number, ly: number): void {
  if (lx < 0 || ly < 0 || lx >= region.size.w || ly >= region.size.h) {
    throw new Error(`world registry: local cell out of bounds for ${region.id}`);
  }
}

/**
 * Parses a `ZoneId` into its `regionId` and `localId` components.
 *
 * @param zoneId - Zone identifier in the form `<regionId>:<localId>`
 * @returns An object with `regionId` (the `WorldRegionId` prefix) and `localId` (the zone-local identifier)
 * @throws Error if `zoneId` is missing the separator, has empty segments, or the `regionId` does not contain `@`
 */
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

/**
 * Convert region-local cell coordinates to global grid coordinates.
 *
 * @param region - The region whose anchor defines the global offset
 * @param lx - Local x coordinate within the region (zero-based)
 * @param ly - Local y coordinate within the region (zero-based)
 * @returns An object with `gx` and `gy` representing the coordinates on the global grid
 */
export function toGlobal(
  region: WorldRegion,
  lx: number,
  ly: number,
): { gx: number; gy: number } {
  return { gx: region.anchor.gx + lx, gy: region.anchor.gy + ly };
}

/**
 * Convert global grid coordinates to region-local cell coordinates.
 *
 * @param region - The target region whose anchor and size define the local space
 * @param gx - Global x coordinate
 * @param gy - Global y coordinate
 * @returns `{ lx, ly }` representing the local cell coordinates when the global point is inside `region`, `null` otherwise
 */
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

/**
 * Finds the region that contains the given global coordinates.
 *
 * @param gx - Global x coordinate in world grid
 * @param gy - Global y coordinate in world grid
 * @returns The region whose bounds include (`gx`, `gy`), or `null` if no region contains that point
 */
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

/**
 * Finds the zone that contains the given region-local cell coordinates.
 *
 * @param regionId - The world region identifier to search within
 * @param lx - The region-local x (cell) coordinate
 * @param ly - The region-local y (cell) coordinate
 * @returns The first `Zone` whose rectangle includes the cell, or `null` if none match
 */
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

/**
 * Look up a region by its WorldRegionId.
 *
 * @returns The matching `WorldRegion` if found, `undefined` otherwise.
 */
export function getRegionById(id: WorldRegionId): WorldRegion | undefined {
  return ensureRegistry().regions.find((r) => r.id === id);
}

/**
 * Provides the default WorldRegistryBundle for the "beginning fields" region used by tests and lazy initialization.
 *
 * @returns A WorldRegistryBundle containing the BEGINNING_FIELDS region with its zones, POIs, default player and NPC spawns, and background NPC entries.
 */
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
        npcSpawns: {
          "npc-1": { lx: 23, ly: 10 },
          "npc-2": { lx: 9, ly: 21 },
          "npc-3": { lx: 28, ly: 27 },
        },
        backgroundNpc: [
          {
            id: "bg-villager-1",
            lx: 33,
            ly: 11,
            displayNameZh: "老张",
            wanderZoneId: "beginning-fields@v1:plaza",
            activityKey: "wandering",
          },
          {
            id: "bg-villager-2",
            lx: 30,
            ly: 15,
            displayNameZh: "小满",
            wanderZoneId: "beginning-fields@v1:plaza",
            activityKey: "wandering",
          },
          {
            id: "bg-villager-3",
            lx: 19,
            ly: 12,
            displayNameZh: "阿牛",
            wanderZoneId: "beginning-fields@v1:orchard",
            activityKey: "wandering",
          },
          {
            id: "bg-villager-4",
            lx: 25,
            ly: 25,
            displayNameZh: "巧娘",
            wanderZoneId: "beginning-fields@v1:pond",
            activityKey: "wandering",
          },
        ],
      },
    },
  };
}

/**
 * Builds a default WorldRegistryBundle containing two regions (Beginning Fields and Village Plaza)
 * populated with their zones, POIs, and spawn configurations.
 *
 * @returns A WorldRegistryBundle derived from `defaultBeginningFieldsBundle()` extended with
 * the `VILLAGE_PLAZA_ID` region, its zones (`plaza`, `market`), POIs (`fountain`, `notice-board`),
 * and spawn entries.
 */
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
        npcSpawns: {},
      },
    },
  };
}
