import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadWorldRegistry, type WorldRegionId } from "@aetherlife/shared";
import { validateNpcSchedulesAgainstRegistry } from "../ambient/schedule.js";
import { registerRegionCollision } from "./region-walkability.js";

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../data/world");

type RegionsFile = {
  regions: Array<{ id: string; size: { w: number; h: number } }>;
};

/** Load WorldRegion registry + collision grids from disk (game-server boot). */
export function bootWorldRegistry(): void {
  const regionsFile = JSON.parse(readFileSync(join(DATA_DIR, "regions.json"), "utf8")) as RegionsFile;
  const zonesByRegionId: Record<string, unknown> = {};
  const poisByRegionId: Record<string, unknown> = {};
  const spawnsByRegionId: Record<string, unknown> = {};

  for (const region of regionsFile.regions) {
    const regionDir = join(DATA_DIR, region.id);
    zonesByRegionId[region.id] = JSON.parse(
      readFileSync(join(regionDir, "zones.json"), "utf8"),
    );
    poisByRegionId[region.id] = JSON.parse(
      readFileSync(join(regionDir, "pois.json"), "utf8"),
    );
    spawnsByRegionId[region.id] = JSON.parse(
      readFileSync(join(regionDir, "spawns.json"), "utf8"),
    );

    const collisionPath = join(regionDir, "collision.json");
    if (existsSync(collisionPath)) {
      const collision = JSON.parse(readFileSync(collisionPath, "utf8"));
      registerRegionCollision(region.id as WorldRegionId, collision, region.size);
    }
  }

  const registry = loadWorldRegistry({
    regions: regionsFile,
    zonesByRegionId,
    poisByRegionId,
    spawnsByRegionId,
  });
  validateNpcSchedulesAgainstRegistry(registry);
}
