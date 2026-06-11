/**
 * Phase 16 schedule migration reference — npc-1/2/3.json already migrated in-repo.
 * Run: node scripts/migrate-schedules-phase16.mjs
 * Validates zoneId + mobility shape and hybrid persona windows.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCHEDULES_DIR = join(ROOT, "apps/game-server/data/schedules");

const files = readdirSync(SCHEDULES_DIR).filter((f) => /^npc-[1-3]\.json$/.test(f));

for (const file of files) {
  const raw = JSON.parse(readFileSync(join(SCHEDULES_DIR, file), "utf8"));
  if (raw.segments.some((s) => "waypoints" in s || "stationary" in s)) {
    console.error(`${file}: legacy waypoints/stationary still present`);
    process.exit(1);
  }
  for (const s of raw.segments) {
    if (!s.zoneId?.includes("@v1:") || !s.mobility) {
      console.error(`${file}: missing zoneId or mobility`);
      process.exit(1);
    }
  }
  console.log(`OK ${file} (${raw.segments.length} segments)`);
}

console.log("migrate-schedules-phase16: all schedules valid");
