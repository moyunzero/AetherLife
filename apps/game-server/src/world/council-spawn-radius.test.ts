import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BEGINNING_FIELDS_ID,
  defaultBeginningFieldsBundle,
  type CouncilSpawnEntry,
  type RegionSpawns,
} from "@aetherlife/shared";
import { describe, expect, it } from "vitest";

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../data/world");

describe("council spawn radius dual-SSOT", () => {
  it("disk spawns.json ≡ defaultBeginningFieldsBundle ≡ 40 for all 12 council slots", () => {
    const disk = JSON.parse(
      readFileSync(join(DATA_DIR, BEGINNING_FIELDS_ID, "spawns.json"), "utf8"),
    ) as RegionSpawns;
    const diskSlots = disk.councilSpawns ?? [];
    expect(diskSlots).toHaveLength(12);

    const bundleSpawns = defaultBeginningFieldsBundle().spawnsByRegionId[
      BEGINNING_FIELDS_ID
    ] as RegionSpawns;
    const bundleSlots = bundleSpawns.councilSpawns ?? [];
    expect(bundleSlots).toHaveLength(12);

    for (let i = 0; i < 12; i++) {
      const diskSlot = diskSlots[i] as CouncilSpawnEntry;
      const bundleSlot = bundleSlots[i] as CouncilSpawnEntry;
      expect(bundleSlot).toEqual(diskSlot);
      expect(diskSlot.maxRadius).toBe(40);
      expect(bundleSlot.maxRadius).toBe(40);
    }
  });
});
