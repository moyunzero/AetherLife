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

/**
 * Get or create the per-room cached intent map for the specified room.
 *
 * @param roomId - The room identifier used as the cache key
 * @returns A Map keyed by `npcId` containing the room's `CachedIntent` entries
 */
function roomCache(roomId: string): Map<string, CachedIntent> {
  let room = cacheByRoom.get(roomId);
  if (!room) {
    room = new Map();
    cacheByRoom.set(roomId, room);
  }
  return room;
}

/**
 * Determine whether an ambient intent is expired for the given game minute.
 *
 * The function compares a normalized `currentMinute` against the intent's `untilGameMinute`
 * and the minute when the intent was enqueued; the validity window treats `untilGameMinute`
 * as an exclusive end and correctly handles windows that wrap past the minute boundary.
 *
 * @param intent - The ambient intent containing `untilGameMinute`
 * @param currentMinute - The current game minute to evaluate
 * @param enqueuedAtMinute - The game minute when the intent was enqueued
 * @returns `true` if the intent is expired at `currentMinute`, `false` otherwise
 */
export function isIntentExpired(intent: AmbientIntent, currentMinute: number, enqueuedAtMinute: number): boolean {
  const until = normalizeMinute(intent.untilGameMinute);
  const cur = normalizeMinute(currentMinute);
  const start = normalizeMinute(enqueuedAtMinute);
  if (start <= until) {
    return cur >= until || cur < start;
  }
  return cur >= until && cur < start;
}

/**
 * Cache an ambient intent for an NPC in a room and apply it to the live room state.
 *
 * Stores the provided intent under the given room and NPC, setting `receivedAt` to the current timestamp, and updates the live Colyseus-backed room state so the NPC reflects the new intent.
 *
 * @param roomId - The ID of the room where the NPC resides
 * @param npcId - The NPC identifier
 * @param entry - The intent record to cache (all `CachedIntent` fields except `receivedAt`; `receivedAt` will be set to the current time)
 */
export function setIntent(
  roomId: string,
  npcId: string,
  entry: Omit<CachedIntent, "receivedAt">,
): void {
  roomCache(roomId).set(npcId, { ...entry, receivedAt: Date.now() });
  applyIntentToLiveRoom(roomId, npcId, entry.intent, entry.gameMinute, entry.initiatorPlayerId);
}

/**
 * Retrieve the cached ambient intent for an NPC in a room.
 *
 * @param roomId - The room identifier
 * @param npcId - The NPC identifier
 * @returns The cached intent for the NPC, or `undefined` if none exists
 */
export function getIntent(roomId: string, npcId: string): CachedIntent | undefined {
  return roomCache(roomId).get(npcId);
}

/**
 * Removes the cached ambient intent for the specified NPC in a room.
 *
 * @param roomId - Identifier of the room containing the NPC
 * @param npcId - Identifier of the NPC whose cached intent will be removed
 */
export function clearIntent(roomId: string, npcId: string): void {
  roomCache(roomId).delete(npcId);
}

/**
 * Remove all cached ambient intents for a specific room.
 *
 * @param roomId - The room identifier whose per-room intent cache will be deleted
 */
export function clearRoomIntents(roomId: string): void {
  cacheByRoom.delete(roomId);
}

/**
 * Selects the nearest player's ID to the given NPC within the Colyseus room.
 *
 * @param roomId - The Colyseus room identifier to inspect
 * @param npc - Object containing NPC coordinates (`x`, `y`)
 * @returns The `playerId` of the closest player using Chebyshev distance, or `undefined` if the room is unavailable or no player with a valid `playerId` is found
 */
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

/**
 * Apply an AmbientIntent to an NPC in the room's map state and push the updated map into the live Colyseus room.
 *
 * The function updates the NPC's displayed reason (resolving or falling back when the provided reason is redundant
 * with the NPC's current activity), toggles and timestamps a temporary "join vicinity" effect when requested
 * (optionally associating it with an initiator or the nearest player), and synchronizes the modified map into the
 * Colyseus room state.
 *
 * @param roomId - Identifier of the room whose map and Colyseus state will be updated
 * @param npcId - Identifier of the NPC to modify
 * @param intent - Ambient intent to apply; `reasonZh` and `joinVicinity` are used to set the NPC's reason and vicinity fields
 * @param gameMinute - Current in-game minute used to resolve schedule-aware fallback reasons
 * @param initiatorPlayerId - Optional playerId to prefer as the initiator for a join-vicinity effect; if omitted the nearest player may be used
 */
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
