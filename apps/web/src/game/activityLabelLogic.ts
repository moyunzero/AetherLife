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

export function truncateActivityLabel(text: string): string {
  if (text.length <= 12) return text;
  return `${text.slice(0, 11)}…`;
}

export function truncateIntentLabel(text: string): string {
  if (text.length <= 16) return text;
  return `${text.slice(0, 15)}…`;
}

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

function isJoinVicinityActive(ambient: NpcAmbientUiState, nowMs: number): boolean {
  if (ambient.joinVicinityActive) return true;
  const until = ambient.joinVicinityUntil ?? 0;
  return until > 0 && nowMs < until;
}

function joinActivityExpired(ambient: NpcAmbientUiState, nowMs: number): boolean {
  const started = ambient.joinVicinityStartedAt ?? 0;
  if (started > 0 && nowMs - started >= JOIN_ACTIVITY_MAX_MS) return true;
  return false;
}

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

/** Player-visible intent subline abolished (CONTEXT D-intent-ui-ship-without-subline). */
export function shouldShowIntentSubline(_params: ShouldShowIntentSublineParams): boolean {
  return false;
}
