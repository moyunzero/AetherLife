import { activityDisplayZh, isReasonZhRedundantWithActivity } from "@aetherlife/shared";
import { chebyshevDistance } from "./ProximityNameplate.js";

const PROXIMITY_CELLS = 2;
const JOIN_ACTIVITY_MAX_DIST = 5;
const JOIN_ACTIVITY_MAX_MS = 8000;
const JOIN_ACTIVITY_ZH = "正朝你走来";

export type NpcAmbientUiState = {
  activityKey: string;
  intentReasonZh?: string;
  joinVicinityActive?: boolean;
  joinVicinityUntil?: number;
  joinVicinityStartedAt?: number;
};

export type ShouldShowActivityParams = {
  gx: number;
  gy: number;
  localGx: number;
  localGy: number;
  npcId: string;
  ambient: NpcAmbientUiState;
  thinkingNpcId: string | null;
  activeNpcId: string | null;
  speakBusyNpcId: string | null;
  nowMs?: number;
};

/**
 * Truncates an activity label to at most 12 characters, appending an ellipsis when truncated.
 *
 * @param text - The original label text
 * @returns The original `text` if its length is 12 characters or fewer; otherwise the first 11 characters followed by `…`
 */
export function truncateActivityLabel(text: string): string {
  if (text.length <= 12) return text;
  return `${text.slice(0, 11)}…`;
}

/**
 * Truncates an intent label to at most 16 characters, appending an ellipsis when truncated.
 *
 * @param text - The label text to truncate
 * @returns The original `text` if its length is 16 characters or fewer; otherwise the first 15 characters followed by `…`
 */
export function truncateIntentLabel(text: string): string {
  if (text.length <= 16) return text;
  return `${text.slice(0, 15)}…`;
}

/**
 * Determines whether an NPC's activity/speech label should be suppressed due to thinking or speak-busy state.
 *
 * @param npcId - The ID of the NPC being evaluated
 * @param thinkingNpcId - The ID of the NPC currently marked as thinking, or `null`
 * @param activeNpcId - The ID of the currently active NPC, or `null`
 * @param speakBusyNpcId - The ID of the NPC currently busy speaking, or `null`
 * @returns `true` if `npcId` equals `thinkingNpcId`, or if `npcId` is the active NPC and also equals `speakBusyNpcId`; `false` otherwise.
 */
function isSpeakOrThinkingBlocked(
  npcId: string,
  thinkingNpcId: string | null,
  activeNpcId: string | null,
  speakBusyNpcId: string | null,
): boolean {
  if (npcId === thinkingNpcId) return true;
  if (speakBusyNpcId !== null && npcId === activeNpcId && speakBusyNpcId === npcId) {
    return true;
  }
  return false;
}

/**
 * Determine whether the ambient state's "join vicinity" condition is active at the given time.
 *
 * Checks the explicit `joinVicinityActive` flag first; if not set, treats `joinVicinityUntil` (defaulting to 0)
 * as an expiration timestamp and considers the condition active when `joinVicinityUntil > 0` and `nowMs < joinVicinityUntil`.
 *
 * @param ambient - The NPC ambient UI state containing join-vicinity flags and timestamps
 * @param nowMs - The current time in milliseconds used to evaluate `joinVicinityUntil`
 * @returns `true` if the join-vicinity condition is active, `false` otherwise.
 */
function isJoinVicinityActive(ambient: NpcAmbientUiState, nowMs: number): boolean {
  if (ambient.joinVicinityActive) return true;
  const until = ambient.joinVicinityUntil ?? 0;
  return until > 0 && nowMs < until;
}

/**
 * Determines whether a join-vicinity activity has expired.
 *
 * Checks `ambient.joinVicinityStartedAt` against `nowMs` using the configured
 * `JOIN_ACTIVITY_MAX_MS` threshold.
 *
 * @param ambient - NPC ambient UI state; `joinVicinityStartedAt` is used as the start time
 * @param nowMs - Current time in milliseconds used to evaluate expiration
 * @returns `true` if `joinVicinityStartedAt` is greater than zero and the elapsed time since it is greater than or equal to `JOIN_ACTIVITY_MAX_MS`, `false` otherwise.
 */
function joinActivityExpired(ambient: NpcAmbientUiState, nowMs: number): boolean {
  const started = ambient.joinVicinityStartedAt ?? 0;
  if (started > 0 && nowMs - started >= JOIN_ACTIVITY_MAX_MS) return true;
  return false;
}

/**
 * Resolve the visible Chinese activity label for an NPC based on ambient UI state, player proximity, and NPC interaction locks.
 *
 * @param ambient - NPC ambient UI state containing `activityKey` and optional join-vicinity timing/flags
 * @param playerDistanceCells - Chebyshev distance in grid cells between player and NPC used for proximity checks
 * @param npcId - ID of the NPC for which the label is being resolved (used to apply thinking/speaking blocks)
 * @param thinkingNpcId - ID of the NPC currently thinking, or `null`
 * @param activeNpcId - ID of the NPC currently active, or `null`
 * @param speakBusyNpcId - ID of the NPC currently busy speaking, or `null`
 * @param nowMs - Optional current time in milliseconds for evaluating join-vicinity time windows; defaults to `Date.now()`
 * @returns The resolved Chinese activity label string when one should be shown, or `null` when no label should be displayed
 */
export function resolveActivityLabel(params: {
  ambient: NpcAmbientUiState;
  playerDistanceCells: number;
  npcId: string;
  thinkingNpcId: string | null;
  activeNpcId: string | null;
  speakBusyNpcId: string | null;
  nowMs?: number;
}): string | null {
  const {
    ambient,
    playerDistanceCells,
    npcId,
    thinkingNpcId,
    activeNpcId,
    speakBusyNpcId,
    nowMs = Date.now(),
  } = params;

  if (isSpeakOrThinkingBlocked(npcId, thinkingNpcId, activeNpcId, speakBusyNpcId)) {
    return null;
  }

  if (
    isJoinVicinityActive(ambient, nowMs)
    && !joinActivityExpired(ambient, nowMs)
    && playerDistanceCells <= JOIN_ACTIVITY_MAX_DIST
  ) {
    return JOIN_ACTIVITY_ZH;
  }

  const key = ambient.activityKey.trim();
  if (!key || key === "idle") return null;
  const label = activityDisplayZh(key);
  return label || null;
}

/**
 * Determines whether an NPC activity label should be visible given positions, NPC state, and ambient UI state.
 *
 * @param params - Input object containing NPC and player grid coordinates, NPC state identifiers, ambient UI state, and optional current time
 * @returns `true` if an activity label should be shown for the NPC, `false` otherwise
 */
export function shouldShowActivity(params: ShouldShowActivityParams): boolean {
  const dist = chebyshevDistance(params.gx, params.gy, params.localGx, params.localGy);
  if (dist > PROXIMITY_CELLS) return false;

  const label = resolveActivityLabel({
    ambient: params.ambient,
    playerDistanceCells: dist,
    npcId: params.npcId,
    thinkingNpcId: params.thinkingNpcId,
    activeNpcId: params.activeNpcId,
    speakBusyNpcId: params.speakBusyNpcId,
    nowMs: params.nowMs,
  });
  return label !== null;
}

/**
 * Compute the effective Chinese intent reason for an activity, omitting empty or redundant values.
 *
 * @param activityKey - The activity key used to check redundancy against the intent reason
 * @param intentReasonZh - The candidate Chinese intent reason (may be `undefined`)
 * @returns The trimmed intent reason, or an empty string if the input is empty or redundant with the activity
 */
export function effectiveIntentReasonZh(
  activityKey: string,
  intentReasonZh: string | undefined,
): string {
  const trimmed = (intentReasonZh ?? "").trim();
  if (!trimmed) return "";
  if (isReasonZhRedundantWithActivity(activityKey, trimmed)) return "";
  return trimmed;
}

export type ShouldShowIntentSublineParams = {
  intentReasonZh: string;
  gx: number;
  gy: number;
  localGx: number;
  localGy: number;
  npcId: string;
  thinkingNpcId: string | null;
  activeNpcId: string | null;
  speakBusyNpcId: string | null;
  dwellMs: number;
  isFirstProximityThisSegment: boolean;
  joinVicinityActive: boolean;
  npcMovedSinceLastFrame: boolean;
};

/**
 * Suppresses the player-visible intent subline UI.
 *
 * @returns `false` indicating the intent subline should not be shown.
 */
export function shouldShowIntentSubline(_params: ShouldShowIntentSublineParams): boolean {
  return false;
}
