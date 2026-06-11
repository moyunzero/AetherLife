import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isKnownActivityKey, type WorldRegistry } from "@aetherlife/shared";

const MAX_SEGMENTS = 48;

const SCHEDULES_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../data/schedules");

export type Mobility = "wander" | "stationary" | "poi";

export type ScheduleSegment = {
  fromMinute: number;
  toMinute: number;
  activityKey: string;
  zoneId: string;
  mobility: Mobility;
};

export type NpcSchedule = {
  npcId: string;
  persona: string;
  segments: ScheduleSegment[];
};

/**
 * Ensure an activity key is valid for schedules, coercing unknown keys to `"idle"`.
 *
 * @param key - The activity key to validate
 * @returns The original `key` if it is a known activity key, otherwise `"idle"`
 */
export function validateActivityKey(key: string): string {
  return isKnownActivityKey(key) ? key : "idle";
}

/**
 * Normalize an integer minute into the range 0–1439 (minutes since midnight).
 *
 * @param minute - A minute value that may be negative or outside a single day
 * @returns The equivalent minute within 0–1439
 */
export function normalizeMinute(minute: number): number {
  return ((minute % 1440) + 1440) % 1440;
}

/**
 * Produces a stable string key that uniquely identifies a schedule segment for change detection.
 *
 * @param segment - The schedule segment to key
 * @returns A stable string combining `zoneId`, `activityKey`, `mobility`, and the `fromMinute-toMinute` range
 */
export function segmentKey(segment: ScheduleSegment): string {
  return `${segment.zoneId}|${segment.activityKey}|${segment.mobility}|${segment.fromMinute}-${segment.toMinute}`;
}

/**
 * Determines whether a given minute falls inside a schedule segment.
 *
 * Minutes are normalized into the range 0–1439. The segment is treated as a half-open interval
 * that includes `fromMinute` and excludes `toMinute`. Segments that wrap past midnight are supported.
 *
 * @param minute - The minute to test (may be outside 0–1439; will be normalized)
 * @param fromMinute - Segment start minute (inclusive; will be normalized)
 * @param toMinute - Segment end minute (exclusive; will be normalized)
 * @returns `true` if the normalized `minute` lies within the segment, `false` otherwise.
 */
export function minuteInSegment(minute: number, fromMinute: number, toMinute: number): boolean {
  const m = normalizeMinute(minute);
  const from = normalizeMinute(fromMinute);
  const to = normalizeMinute(toMinute);

  if (from <= to) {
    return m >= from && m < to;
  }
  return m >= from || m < to;
}

/**
 * Determines whether an NPC should not move during the given schedule segment.
 *
 * @param segment - The schedule segment to evaluate
 * @returns `true` if the segment's activity is `"idle"` or `"resting"`, `false` otherwise
 */
export function shouldSkipMovement(segment: ScheduleSegment): boolean {
  return segment.activityKey === "idle" || segment.activityKey === "resting";
}

/**
 * Determines whether a mobility value represents a linger behaviour.
 *
 * @param mobility - The mobility classification to check
 * @returns `true` if `mobility` is `"stationary"` or `"poi"`, `false` otherwise
 */
export function isLingerMobility(mobility: Mobility): boolean {
  return mobility === "stationary" || mobility === "poi";
}

const MOBILITY_SET = new Set<Mobility>(["wander", "stationary", "poi"]);

/**
 * Loads and validates an NPC schedule JSON file and returns a normalized NpcSchedule.
 *
 * @param filePath - Path to the schedule JSON file
 * @returns The parsed and normalized `NpcSchedule` with validated segments
 * @throws Error if the file is malformed or missing required fields, if the segment count exceeds `MAX_SEGMENTS`, if any segment contains legacy `waypoints`/`stationary` fields, if a segment is missing `zoneId`, or if a segment's `mobility` is invalid
 */
function parseScheduleFile(filePath: string): NpcSchedule {
  const raw = JSON.parse(readFileSync(filePath, "utf8")) as NpcSchedule & {
    segments: Array<Record<string, unknown>>;
  };
  if (!raw.npcId || !Array.isArray(raw.segments)) {
    throw new Error(`Invalid schedule file: ${filePath}`);
  }
  if (raw.segments.length > MAX_SEGMENTS) {
    throw new Error(`Schedule ${raw.npcId} exceeds max segments (${MAX_SEGMENTS})`);
  }

  const segments = raw.segments.map((segment) => {
    if ("waypoints" in segment || "stationary" in segment) {
      throw new Error(`Schedule ${raw.npcId}: legacy waypoints/stationary fields are not supported`);
    }
    if (!segment.zoneId || typeof segment.zoneId !== "string") {
      throw new Error(`Schedule ${raw.npcId}: segment missing zoneId`);
    }
    if (!MOBILITY_SET.has(segment.mobility as Mobility)) {
      throw new Error(`Schedule ${raw.npcId}: invalid mobility ${segment.mobility}`);
    }
    return {
      fromMinute: segment.fromMinute as number,
      toMinute: segment.toMinute as number,
      activityKey: validateActivityKey(segment.activityKey as string),
      zoneId: segment.zoneId as string,
      mobility: segment.mobility as Mobility,
    };
  });

  return { npcId: raw.npcId, persona: raw.persona, segments };
}

function loadSchedules(): Map<string, NpcSchedule> {
  const schedules = new Map<string, NpcSchedule>();
  const files = readdirSync(SCHEDULES_DIR).filter((name) => /^npc-[1-3]\.json$/.test(name));

  for (const file of files) {
    const schedule = parseScheduleFile(join(SCHEDULES_DIR, file));
    schedules.set(schedule.npcId, schedule);
  }

  return schedules;
}

const SCHEDULES = loadSchedules();

/**
 * Get the schedule segment active for an NPC at a given game minute.
 *
 * The supplied minute is normalized into the 0–1439 range before matching.
 *
 * @param gameMinute - Minute of the game day; any integer is accepted and will be normalized to 0–1439
 * @returns The matching `ScheduleSegment` for the normalized minute, or `null` if no segment applies or the NPC schedule is not present
 */
export function resolveScheduleSegment(npcId: string, gameMinute: number): ScheduleSegment | null {
  const schedule = SCHEDULES.get(npcId);
  if (!schedule) return null;

  const minute = normalizeMinute(gameMinute);
  for (const segment of schedule.segments) {
    if (minuteInSegment(minute, segment.fromMinute, segment.toMinute)) {
      return segment;
    }
  }
  return null;
}

/**
 * Get the number of NPC schedules currently loaded.
 *
 * @returns The count of NPC schedules loaded into memory.
 */
export function loadedScheduleCount(): number {
  return SCHEDULES.size;
}

/**
 * Retrieves the full loaded schedule for an NPC for use in tests and assertions.
 *
 * @param npcId - The NPC identifier
 * @returns The NPC's schedule, or `undefined` if no schedule is loaded for `npcId`
 */
export function getNpcSchedule(npcId: string): NpcSchedule | undefined {
  return SCHEDULES.get(npcId);
}

/**
 * Validate that every loaded NPC schedule segment references an existing zone in the provided WorldRegistry.
 *
 * @param registry - The world registry whose zones are considered authoritative
 * @throws {Error} When any loaded schedule contains a segment with a `zoneId` not present in the registry
 */
export function validateNpcSchedulesAgainstRegistry(registry: WorldRegistry): void {
  const knownZoneIds = new Set<string>();
  for (const zones of registry.zonesByRegion.values()) {
    for (const zone of zones) {
      knownZoneIds.add(zone.zoneId);
    }
  }
  for (const schedule of SCHEDULES.values()) {
    for (const segment of schedule.segments) {
      if (!knownZoneIds.has(segment.zoneId)) {
        throw new Error(
          `Schedule ${schedule.npcId}: segment references unknown zoneId ${segment.zoneId}`,
        );
      }
    }
  }
}
