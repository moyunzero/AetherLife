import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isKnownActivityKey } from "@aetherlife/shared";

const MAX_SEGMENTS = 48;
const MAX_WAYPOINTS = 32;

const SCHEDULES_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../data/schedules");

export type ScheduleWaypoint = {
  gx: number;
  gy: number;
};

export type ScheduleSegment = {
  fromMinute: number;
  toMinute: number;
  activityKey: string;
  stationary: boolean;
  waypoints: ScheduleWaypoint[];
  waypointMode?: "loop" | "once";
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

function normalizeMinute(minute: number): number {
  return ((minute % 1440) + 1440) % 1440;
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

function parseScheduleFile(filePath: string): NpcSchedule {
  const raw = JSON.parse(readFileSync(filePath, "utf8")) as NpcSchedule;
  if (!raw.npcId || !Array.isArray(raw.segments)) {
    throw new Error(`Invalid schedule file: ${filePath}`);
  }
  if (raw.segments.length > MAX_SEGMENTS) {
    throw new Error(`Schedule ${raw.npcId} exceeds max segments (${MAX_SEGMENTS})`);
  }

  const segments = raw.segments.map((segment) => {
    if (segment.waypoints.length > MAX_WAYPOINTS) {
      throw new Error(`Schedule ${raw.npcId} segment exceeds max waypoints (${MAX_WAYPOINTS})`);
    }
    return {
      ...segment,
      activityKey: validateActivityKey(segment.activityKey),
      waypoints: segment.waypoints.map((wp) => ({ gx: wp.gx, gy: wp.gy })),
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

/** Resolve the active schedule segment for an NPC at a game minute (stub — no movement). */
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
