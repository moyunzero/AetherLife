/**
 * Council vote trigger scheduler (D-VOTE-TRIG-01…09).
 *
 * Env tunables (verify / ship overrides):
 * - VOTE_TEST_INTERVAL_MIN — regular interval in game-days (default 30)
 * - VOTE_TEST_REAL_MIN_MS — wall-clock floor since last vote (default 20min)
 * - VOTE_COLLECTIVE_WEIGHT_THRESHOLD — sum |deltaScore| for early regular (default 80)
 * - VOTE_EPOCH_YEARS — epoch cadence in chronicle years (default 5)
 */
import {
  chronicleGameYearFromMinute,
  type CouncilDeliberationVoteKind,
} from "@aetherlife/shared";
import { addWorldVoteJob, clearWorldVotePending } from "../queue/world-vote.js";
import {
  getRoomVoteState,
  markVoteEnqueued,
  recordCollectiveEvent,
  recordPlayerSpeak,
  recordVoteCompleted as persistVoteCompleted,
  tickRoomVoteClock,
} from "./world-vote-state.js";

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
  persistVoteCompleted(roomId, input);
}

const GAME_DAY_MINUTES = 1440;
const COUNCIL_SEATS = 12;
const DEFAULT_REGULAR_INTERVAL_DAYS = 30;
const DEFAULT_REGULAR_REAL_MIN_MS = 20 * 60 * 1000;
const DEFAULT_COLLECTIVE_THRESHOLD = 80;
const DEFAULT_EPOCH_YEARS = 5;
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
  | "force";

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

function epochYears(): number {
  const raw = process.env.VOTE_EPOCH_YEARS;
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return DEFAULT_EPOCH_YEARS;
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
  const currentYear = chronicleGameYearFromMinute(state.absoluteGameMinute);
  const lastYear = chronicleGameYearFromMinute(
    state.lastVoteAbsoluteMinute ?? 0,
  );
  return currentYear >= lastYear + epochYears();
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
      debateRoundsMax: 2,
    };
  }

  if (input.npcSpeakInFlight) {
    return { ...base, reason: "speak_in_flight" };
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
      debateRoundsMax: 3,
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
      debateRoundsMax: 2,
    };
  }

  return { ...base, reason: "not_due" };
}

export async function maybeEnqueueWorldVote(input: {
  roomId: string;
  gameMinute: number;
  nowMs?: number;
  npcSpeakInFlight: boolean;
}): Promise<string | null> {
  tickRoomVoteClock(input.roomId);
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
    proposerIndex: result.proposerIndex,
    debateRoundsMax: result.debateRoundsMax,
  });
}

export async function forceEnqueueWorldVote(input: {
  roomId: string;
  gameMinute: number;
  voteKind?: CouncilDeliberationVoteKind;
}): Promise<string | null> {
  const state = getRoomVoteState(input.roomId);
  const proposerIndex = nextProposerIndex(state);
  const voteKind = input.voteKind ?? "regular";
  const debateRoundsMax = voteKind === "epoch" ? 3 : 2;
  markVoteEnqueued(input.roomId, proposerIndex);
  return addWorldVoteJob({
    roomId: input.roomId,
    voteKind,
    gameMinute: input.gameMinute,
    proposerIndex,
    debateRoundsMax,
  });
}
