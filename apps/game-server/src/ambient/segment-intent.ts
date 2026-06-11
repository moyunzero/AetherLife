import type { ScheduleSegment } from "./schedule.js";
import { pickIntentFallbackReasonZh } from "./intent-fallback.js";
import { setIntent } from "./intent-cache.js";

/**
 * Apply a synchronous fallback intent for an NPC at the start of a schedule segment.
 *
 * Computes a Chinese fallback reason from the NPC and segment properties and stores an intent
 * in the intent cache with `zoneId`, `reasonZh`, `untilGameMinute` (from `segment.toMinute`),
 * `trigger` set to `"segment_change"`, and the provided `gameMinute`.
 *
 * @param roomId - ID of the room where the NPC is located
 * @param npcId - ID of the NPC to apply the fallback intent for
 * @param segment - The schedule segment that is starting (provides `zoneId`, `activityKey`, `mobility`, `toMinute`)
 * @param gameMinute - Current in-game minute when the fallback is applied
 */
export function applySegmentStartIntentFallback(
  roomId: string,
  npcId: string,
  segment: ScheduleSegment,
  gameMinute: number,
): void {
  const reasonZh = pickIntentFallbackReasonZh(
    npcId,
    segment.zoneId,
    segment.activityKey,
    segment.mobility,
  );
  setIntent(roomId, npcId, {
    intent: {
      zoneId: segment.zoneId,
      reasonZh,
      untilGameMinute: segment.toMinute,
    },
    trigger: "segment_change",
    gameMinute,
  });
}
