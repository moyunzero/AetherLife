import type { ScheduleSegment } from "./schedule.js";
import { pickIntentFallbackReasonZh } from "./intent-fallback.js";
import { setIntent } from "./intent-cache.js";

/** Sync segment-start motivation fallback before async ambient intent job. */
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
