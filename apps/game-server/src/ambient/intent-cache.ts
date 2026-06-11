import type { AmbientIntent } from "@aetherlife/shared";
import { findNpc, isReasonZhRedundantWithActivity, isZoneIntent } from "@aetherlife/shared";
import { pickIntentFallbackReasonZh } from "./intent-fallback.js";
import { resolveScheduleSegment } from "./schedule.js";
import { syncColyseusFromMap } from "../colyseus/bridge.js";
import { getColyseusRoom } from "../colyseus/room-registry.js";
import type { GameRoomState } from "../colyseus/schema.js";
import { bumpStateVersion } from "../colyseus/version.js";
import { getOrCreate } from "../room/store.js";
import { normalizeMinute } from "./schedule.js";

export type AmbientIntentTrigger = "segment_change" | "speak_end";

export type CachedIntent = {
  intent: AmbientIntent;
  trigger: AmbientIntentTrigger;
  gameMinute: number;
  receivedAt: number;
  initiatorPlayerId?: string;
};

const JOIN_VICINITY_MS = 8000;

const cacheByRoom = new Map<string, Map<string, CachedIntent>>();

function roomCache(roomId: string): Map<string, CachedIntent> {
  let room = cacheByRoom.get(roomId);
  if (!room) {
    room = new Map();
    cacheByRoom.set(roomId, room);
  }
  return room;
}

/** Intent valid until current minute reaches untilGameMinute (exclusive end of segment window). */
export function isIntentExpired(intent: AmbientIntent, currentMinute: number, enqueuedAtMinute: number): boolean {
  const until = normalizeMinute(intent.untilGameMinute);
  const cur = normalizeMinute(currentMinute);
  const start = normalizeMinute(enqueuedAtMinute);
  if (start <= until) {
    return cur >= until || cur < start;
  }
  return cur >= until && cur < start;
}

export function setIntent(
  roomId: string,
  npcId: string,
  entry: Omit<CachedIntent, "receivedAt">,
): void {
  roomCache(roomId).set(npcId, { ...entry, receivedAt: Date.now() });
  applyIntentToLiveRoom(roomId, npcId, entry.intent, entry.gameMinute, entry.initiatorPlayerId);
}

export function getIntent(roomId: string, npcId: string): CachedIntent | undefined {
  return roomCache(roomId).get(npcId);
}

export function clearIntent(roomId: string, npcId: string): void {
  roomCache(roomId).delete(npcId);
}

export function clearRoomIntents(roomId: string): void {
  cacheByRoom.delete(roomId);
}

function nearestPlayerId(roomId: string, npc: { x: number; y: number }): string | undefined {
  const colyseus = getColyseusRoom(roomId);
  if (!colyseus) return undefined;
  const state = colyseus.state as GameRoomState;
  let bestId: string | undefined;
  let bestD = Infinity;
  state.players.forEach((player) => {
    const pid = player.playerId?.trim();
    if (!pid) return;
    const d = Math.max(Math.abs(npc.x - player.x), Math.abs(npc.y - player.y));
    if (d < bestD) {
      bestD = d;
      bestId = pid;
    }
  });
  return bestId;
}

function applyIntentToLiveRoom(
  roomId: string,
  npcId: string,
  intent: AmbientIntent,
  gameMinute: number,
  initiatorPlayerId?: string,
): void {
  const { state: map } = getOrCreate(roomId);
  const npc = findNpc(map, npcId);
  if (!npc) return;

  const activityKey = npc.activityKey ?? "idle";
  let reasonZh = intent.reasonZh?.trim() ?? "";
  if (reasonZh && isReasonZhRedundantWithActivity(activityKey, reasonZh)) {
    const existing = npc.intentReasonZh?.trim() ?? "";
    if (existing && !isReasonZhRedundantWithActivity(activityKey, existing)) {
      reasonZh = existing;
    } else {
      const segment = resolveScheduleSegment(npcId, gameMinute);
      reasonZh = pickIntentFallbackReasonZh(
        npcId,
        segment?.zoneId ?? (isZoneIntent(intent) ? intent.zoneId : "home-yard"),
        activityKey,
        segment?.mobility,
      );
    }
  }
  npc.intentReasonZh = reasonZh;

  if (intent.joinVicinity) {
    const now = Date.now();
    npc.joinVicinityActive = true;
    npc.joinVicinityStartedAt = now;
    npc.joinVicinityUntil = now + JOIN_VICINITY_MS;
    npc.joinVicinityPlayerId =
      initiatorPlayerId?.trim() || nearestPlayerId(roomId, npc) || undefined;
  } else {
    npc.joinVicinityActive = false;
    npc.joinVicinityUntil = 0;
    npc.joinVicinityStartedAt = 0;
    npc.joinVicinityPlayerId = undefined;
  }

  const colyseus = getColyseusRoom(roomId);
  if (!colyseus) return;
  syncColyseusFromMap(colyseus.state, map);
  bumpStateVersion(colyseus.state);
}

/** Test hook — wipe all cached intents. */
export function clearAllIntentsForTests(): void {
  cacheByRoom.clear();
}
