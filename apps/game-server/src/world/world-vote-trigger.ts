/**
 * Council vote trigger scheduler (D-VOTE-TRIG-01…09).
 *
 * Env tunables (verify / ship overrides):
 * - VOTE_TEST_INTERVAL_MIN — regular interval in game-days (default 30)
 * - VOTE_TEST_REAL_MIN_MS — wall-clock floor since last vote (default 20min)
 * - VOTE_COLLECTIVE_WEIGHT_THRESHOLD — sum |deltaScore| for early regular (default 80)
 * - VOTE_EPOCH_DAYS — epoch cadence in SSOT game-days (default 5)
 * - VOTE_EPOCH_YEARS — if set, maps to years×360 days (back-compat; overrides days default)
 */
import {
  DAYS_PER_YEAR,
  MINUTES_PER_DAY,
  type CouncilDeliberationVoteKind,
} from "@aetherlife/shared";
import { addWorldVoteJob, addWorldVoteContinuationJob, clearWorldVotePending, getPendingWorldVoteJobId } from "../queue/world-vote.js";
import {
  getActiveDeliberation,
  getRoomVoteState,
  markVoteEnqueued,
  recordCollectiveEvent,
  recordPlayerSpeak,
  recordVoteCompleted as persistVoteCompleted,
  tickRoomVoteClock,
  clearActiveDeliberation,
  isDeliberationContinuationDue,
  hasActiveDeliberation,
} from "./world-vote-state.js";
import { capDebateRoundsMax, resolveInstantDebate } from "./world-vote-pacing.js";

export { recordCollectiveEvent, recordPlayerSpeak };

export function recordVoteCompleted(
  roomId: string,
  input: {
    gameMinute: number;
    voteKind: CouncilDeliberationVoteKind;
    proposerIndex: number;
    jobId?: string;
  },
): void {
  clearWorldVotePending(roomId, input.jobId);
  clearActiveDeliberation(roomId);
  persistVoteCompleted(roomId, input);
}

const GAME_DAY_MINUTES = MINUTES_PER_DAY;
const COUNCIL_SEATS = 12;
const DEFAULT_REGULAR_INTERVAL_DAYS = 30;
const DEFAULT_REGULAR_REAL_MIN_MS = 20 * 60 * 1000;
const DEFAULT_COLLECTIVE_THRESHOLD = 80;
const DEFAULT_EPOCH_DAYS = 5;
const COOLDOWN_REGULAR_DAYS = 7;
const COOLDOWN_EPOCH_YEARS = 1;
const GRACE_DAYS = 1;

export type VoteTriggerReason =
  | "speak_in_flight"
  | "grace_period"
  | "cooldown"
  | "not_due"
  | "catch_up_pending"
  | "epoch_due"
  | "regular_due"
  | "collective_weight"
  | "force"
  | "deliberation_in_progress";

export type EvaluateVoteTriggerInput = {
  roomId: string;
  gameMinute: number;
  nowMs: number;
  npcSpeakInFlight: boolean;
  force?: boolean;
};

export type EvaluateVoteTriggerResult = {
  shouldEnqueue: boolean;
  voteKind: CouncilDeliberationVoteKind | null;
  reason: VoteTriggerReason;
  proposerIndex: number;
  debateRoundsMax: number;
};

function regularIntervalDays(): number {
  const raw = process.env.VOTE_TEST_INTERVAL_MIN;
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return DEFAULT_REGULAR_INTERVAL_DAYS;
}

function regularRealMinMs(): number {
  const raw = process.env.VOTE_TEST_REAL_MIN_MS;
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return DEFAULT_REGULAR_REAL_MIN_MS;
}

function collectiveWeightThreshold(): number {
  const raw = process.env.VOTE_COLLECTIVE_WEIGHT_THRESHOLD;
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return DEFAULT_COLLECTIVE_THRESHOLD;
}

/** Epoch spacing in SSOT game-days (D-CAL-05). Prefer VOTE_EPOCH_DAYS; VOTE_EPOCH_YEARS×360 if set. */
function epochIntervalDays(): number {
  const yearsRaw = process.env.VOTE_EPOCH_YEARS;
  if (yearsRaw) {
    const years = Number(yearsRaw);
    if (Number.isFinite(years) && years > 0) {
      return years * DAYS_PER_YEAR;
    }
  }
  const daysRaw = process.env.VOTE_EPOCH_DAYS;
  if (daysRaw) {
    const days = Number(daysRaw);
    if (Number.isFinite(days) && days > 0) return days;
  }
  return DEFAULT_EPOCH_DAYS;
}

function dayIndexFromMinute(absoluteGameMinute: number): number {
  return Math.floor(Math.max(0, absoluteGameMinute) / GAME_DAY_MINUTES);
}

function cooldownMinutes(kind: CouncilDeliberationVoteKind): number {
  if (kind === "epoch") return COOLDOWN_EPOCH_YEARS * GAME_DAY_MINUTES;
  return COOLDOWN_REGULAR_DAYS * GAME_DAY_MINUTES;
}

function graceSatisfied(state: ReturnType<typeof getRoomVoteState>): boolean {
  const elapsed = state.absoluteGameMinute - state.graceStartedAbsoluteMinute;
  return elapsed >= GRACE_DAYS * GAME_DAY_MINUTES && state.hasPlayerSpeak;
}

function inCooldown(
  state: ReturnType<typeof getRoomVoteState>,
  nowMs: number,
): boolean {
  if (state.lastVoteAbsoluteMinute === null || state.lastVoteKind === null) {
    return false;
  }
  const minutesSince =
    state.absoluteGameMinute - state.lastVoteAbsoluteMinute;
  if (minutesSince < cooldownMinutes(state.lastVoteKind)) {
    return true;
  }
  const realFloor = regularRealMinMs();
  if (
    state.lastVoteRealMs !== null &&
    nowMs - state.lastVoteRealMs < realFloor
  ) {
    return true;
  }
  return false;
}

function epochDue(state: ReturnType<typeof getRoomVoteState>): boolean {
  const currentDay = dayIndexFromMinute(state.absoluteGameMinute);
  const lastDay = dayIndexFromMinute(state.lastVoteAbsoluteMinute ?? 0);
  return currentDay - lastDay >= epochIntervalDays();
}

function regularDue(state: ReturnType<typeof getRoomVoteState>): boolean {
  const interval = regularIntervalDays() * GAME_DAY_MINUTES;
  if (state.lastVoteAbsoluteMinute === null) {
    return state.absoluteGameMinute >= interval;
  }
  return state.absoluteGameMinute - state.lastVoteAbsoluteMinute >= interval;
}

function collectiveEarlyRegular(
  state: ReturnType<typeof getRoomVoteState>,
): boolean {
  return state.collectiveWeightSinceVote >= collectiveWeightThreshold();
}

function nextProposerIndex(state: ReturnType<typeof getRoomVoteState>): number {
  return (state.lastProposerIndex + 1) % COUNCIL_SEATS;
}

export function evaluateVoteTrigger(
  input: EvaluateVoteTriggerInput,
): EvaluateVoteTriggerResult {
  const state = getRoomVoteState(input.roomId);
  const proposerIndex = nextProposerIndex(state);

  const base = {
    shouldEnqueue: false,
    voteKind: null as CouncilDeliberationVoteKind | null,
    proposerIndex,
    debateRoundsMax: 2,
  };

  if (input.force) {
    return {
      ...base,
      shouldEnqueue: true,
      voteKind: "regular",
      reason: "force",
      debateRoundsMax: capDebateRoundsMax(2),
    };
  }

  if (input.npcSpeakInFlight) {
    return { ...base, reason: "speak_in_flight" };
  }

  if (hasActiveDeliberation(input.roomId)) {
    return { ...base, reason: "deliberation_in_progress" };
  }

  if (!graceSatisfied(state)) {
    return { ...base, reason: "grace_period" };
  }

  if (inCooldown(state, input.nowMs)) {
    return { ...base, reason: "cooldown" };
  }

  const epoch = epochDue(state);
  const regular = regularDue(state) || collectiveEarlyRegular(state);

  if (epoch) {
    return {
      ...base,
      shouldEnqueue: true,
      voteKind: "epoch",
      reason: epoch && regular ? "epoch_due" : "epoch_due",
      debateRoundsMax: capDebateRoundsMax(3),
    };
  }

  if (regular) {
    const reason: VoteTriggerReason = collectiveEarlyRegular(state)
      ? "collective_weight"
      : "regular_due";
    return {
      ...base,
      shouldEnqueue: true,
      voteKind: "regular",
      reason,
      debateRoundsMax: capDebateRoundsMax(2),
    };
  }

  return { ...base, reason: "not_due" };
}

export async function maybeEnqueueDeliberationContinuation(input: {
  roomId: string;
  gameMinute: number;
}): Promise<string | null> {
  if (getPendingWorldVoteJobId(input.roomId)) {
    return null;
  }
  if (!isDeliberationContinuationDue(input.roomId)) {
    return null;
  }
  const deliberation = getActiveDeliberation(input.roomId);
  if (!deliberation) {
    return null;
  }
  const nextRound = deliberation.currentRound + 1;
  if (nextRound > deliberation.debateRoundsMax) {
    return null;
  }
  return addWorldVoteContinuationJob({
    roomId: input.roomId,
    resumeJobId: deliberation.jobId,
    debateRound: nextRound,
    gameMinute: input.gameMinute,
    absoluteGameMinute: getRoomVoteState(input.roomId).absoluteGameMinute,
    voteKind: deliberation.voteKind,
    proposerIndex: deliberation.proposerIndex,
    debateRoundsMax: deliberation.debateRoundsMax,
  });
}

export async function maybeEnqueueWorldVote(input: {
  roomId: string;
  gameMinute: number;
  nowMs?: number;
  npcSpeakInFlight: boolean;
}): Promise<string | null> {
  tickRoomVoteClock(input.roomId);

  const continuationId = await maybeEnqueueDeliberationContinuation({
    roomId: input.roomId,
    gameMinute: input.gameMinute,
  });
  if (continuationId) {
    return continuationId;
  }

  const result = evaluateVoteTrigger({
    roomId: input.roomId,
    gameMinute: input.gameMinute,
    nowMs: input.nowMs ?? Date.now(),
    npcSpeakInFlight: input.npcSpeakInFlight,
  });
  if (!result.shouldEnqueue || !result.voteKind) return null;

  markVoteEnqueued(input.roomId, result.proposerIndex);
  return addWorldVoteJob({
    roomId: input.roomId,
    voteKind: result.voteKind,
    gameMinute: input.gameMinute,
    absoluteGameMinute: getRoomVoteState(input.roomId).absoluteGameMinute,
    proposerIndex: result.proposerIndex,
    debateRoundsMax: result.debateRoundsMax,
    instant: resolveInstantDebate(),
  });
}

export async function forceEnqueueWorldVote(input: {
  roomId: string;
  gameMinute: number;
  absoluteGameMinute?: number;
  voteKind?: CouncilDeliberationVoteKind;
  debateRoundsMax?: number;
  instant?: boolean;
}): Promise<string | null> {
  if (hasActiveDeliberation(input.roomId)) {
    console.warn(
      `[world-vote] force blocked: room=${input.roomId} paced deliberation in progress`,
    );
    return null;
  }
  const pending = getPendingWorldVoteJobId(input.roomId);
  if (pending) {
    console.warn(
      `[world-vote] force blocked: room=${input.roomId} pending=${pending}`,
    );
    return null;
  }

  const state = getRoomVoteState(input.roomId);
  const proposerIndex = nextProposerIndex(state);
  const voteKind = input.voteKind ?? "regular";
  const debateRoundsMax = capDebateRoundsMax(
    input.debateRoundsMax ?? (voteKind === "epoch" ? 3 : 2),
  );
  markVoteEnqueued(input.roomId, proposerIndex);
  return addWorldVoteJob({
    roomId: input.roomId,
    voteKind,
    gameMinute: input.gameMinute,
    absoluteGameMinute:
      input.absoluteGameMinute ?? state.absoluteGameMinute,
    proposerIndex,
    debateRoundsMax,
    instant: input.instant ?? resolveInstantDebate(),
  });
}
