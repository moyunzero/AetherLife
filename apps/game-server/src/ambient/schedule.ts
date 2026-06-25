import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getPersona, isKnownActivityKey, type WorldRegistry } from "@aetherlife/shared";

const MAX_SEGMENTS = 48;

const SCHEDULES_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../data/schedules");
const NPC_SCHEDULE_FILE = /^npc-(?:[1-9]|1[0-2])\.json$/;

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

/** Coerce unknown activity keys to idle at load/validation time (T-14-01). */
export function validateActivityKey(key: string): string {
  return isKnownActivityKey(key) ? key : "idle";
}

export function normalizeMinute(minute: number): number {
  return ((minute % 1440) + 1440) % 1440;
}

/** Stable key for segment-change detection (enqueue ambient intent). */
export function segmentKey(segment: ScheduleSegment): string {
  return `${segment.zoneId}|${segment.activityKey}|${segment.mobility}|${segment.fromMinute}-${segment.toMinute}`;
}

export function minuteInSegment(minute: number, fromMinute: number, toMinute: number): boolean {
  const m = normalizeMinute(minute);
  const from = normalizeMinute(fromMinute);
  const to = normalizeMinute(toMinute);

  if (from <= to) {
    return m >= from && m < to;
  }
  return m >= from || m < to;
}

/** True sleep / no movement — resting & idle only. Stationary/poi use zone linger (see ambient/README.md). */
export function shouldSkipMovement(segment: ScheduleSegment): boolean {
  return segment.activityKey === "idle" || segment.activityKey === "resting";
}

/** stationary | poi → micro-wander within LINGER_RADIUS; wander → full zone pick. */
export function isLingerMobility(mobility: Mobility): boolean {
  return mobility === "stationary" || mobility === "poi";
}

const MOBILITY_SET = new Set<Mobility>(["wander", "stationary", "poi"]);

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
  const files = readdirSync(SCHEDULES_DIR).filter((name) => NPC_SCHEDULE_FILE.test(name));

  for (const file of files) {
    const schedule = parseScheduleFile(join(SCHEDULES_DIR, file));
    schedules.set(schedule.npcId, schedule);
  }

  return schedules;
}

const SCHEDULES = loadSchedules();

/** Resolve the active schedule segment for an NPC at a game minute. */
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

/** Test hook: loaded schedule count. */
export function loadedScheduleCount(): number {
  return SCHEDULES.size;
}

/** Test hook: full schedule for assertions. */
export function getNpcSchedule(npcId: string): NpcSchedule | undefined {
  return SCHEDULES.get(npcId);
}

/** Fail fast at boot when schedule segment zoneId is absent from WorldRegistry (T-16-01). */
export function validateNpcSchedulesAgainstRegistry(registry: WorldRegistry): void {
  const knownZoneIds = new Set<string>();
  for (const zones of registry.zonesByRegion.values()) {
    for (const zone of zones) {
      knownZoneIds.add(zone.zoneId);
    }
  }
  for (const schedule of SCHEDULES.values()) {
    const expectedPersona = getPersona(schedule.npcId).archetype;
    if (schedule.persona !== expectedPersona) {
      throw new Error(
        `Schedule ${schedule.npcId}: persona ${schedule.persona} !== registry archetype ${expectedPersona}`,
      );
    }
    for (const segment of schedule.segments) {
      if (!knownZoneIds.has(segment.zoneId)) {
        throw new Error(
          `Schedule ${schedule.npcId}: segment references unknown zoneId ${segment.zoneId}`,
        );
      }
    }
  }
}
