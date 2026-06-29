import type { CouncilDeliberationVoteKind } from "@aetherlife/shared";
import { nextRoundAtGameMinute } from "./world-vote-pacing.js";

export type ActiveDeliberationPhase =
  | "proposal"
  | "debate"
  | "vote"
  | "sealed";

export type ActiveDeliberation = {
  jobId: string;
  voteKind: CouncilDeliberationVoteKind;
  proposerIndex: number;
  proposalTitle: string;
  proposalBody: string;
  currentRound: number;
  debateRoundsMax: number;
  nextRoundAtGameMinute: number | null;
  phase: ActiveDeliberationPhase;
  /** Debate lines accumulated across paced round jobs. */
  transcript: Array<{
    npcId: string;
    displayName?: string;
    text: string;
    round: number;
  }>;
};

export type RoomVoteState = {
  /** Monotonic ambient tick counter (1 tick = 1 game-minute step). */
  absoluteGameMinute: number;
  lastVoteAbsoluteMinute: number | null;
  lastVoteRealMs: number | null;
  lastVoteKind: CouncilDeliberationVoteKind | null;
  lastProposerIndex: number;
  collectiveWeightSinceVote: number;
  hasPlayerSpeak: boolean;
  graceStartedAbsoluteMinute: number;
  /** After offline catch-up enqueue, suppress stacking until vote completes. */
  catchUpConsumed: boolean;
  /** Paced deliberation checkpoint (instant mode leaves null). */
  activeDeliberation: ActiveDeliberation | null;
};

const byRoom = new Map<string, RoomVoteState>();

function createInitialState(): RoomVoteState {
  return {
    absoluteGameMinute: 0,
    lastVoteAbsoluteMinute: null,
    lastVoteRealMs: null,
    lastVoteKind: null,
    lastProposerIndex: -1,
    collectiveWeightSinceVote: 0,
    hasPlayerSpeak: false,
    graceStartedAbsoluteMinute: 0,
    catchUpConsumed: false,
    activeDeliberation: null,
  };
}

export function getRoomVoteState(roomId: string): RoomVoteState {
  let state = byRoom.get(roomId);
  if (!state) {
    state = createInitialState();
    byRoom.set(roomId, state);
  }
  return state;
}

export function tickRoomVoteClock(roomId: string): number {
  const state = getRoomVoteState(roomId);
  state.absoluteGameMinute += 1;
  return state.absoluteGameMinute;
}

export function recordPlayerSpeak(roomId: string): void {
  getRoomVoteState(roomId).hasPlayerSpeak = true;
}

export function recordCollectiveEvent(roomId: string, deltaScore: number): void {
  const state = getRoomVoteState(roomId);
  state.collectiveWeightSinceVote += Math.abs(deltaScore);
}

export function markVoteEnqueued(roomId: string, proposerIndex: number): void {
  const state = getRoomVoteState(roomId);
  state.lastProposerIndex = proposerIndex;
  state.catchUpConsumed = true;
}

export function recordVoteCompleted(
  roomId: string,
  input: {
    gameMinute: number;
    voteKind: CouncilDeliberationVoteKind;
    proposerIndex: number;
  },
): void {
  const state = getRoomVoteState(roomId);
  state.lastVoteAbsoluteMinute = state.absoluteGameMinute;
  state.lastVoteRealMs = Date.now();
  state.lastVoteKind = input.voteKind;
  state.lastProposerIndex = input.proposerIndex;
  state.collectiveWeightSinceVote = 0;
  state.catchUpConsumed = false;
}

export function clearRoomVoteStateForTests(): void {
  byRoom.clear();
}

export function setActiveDeliberation(
  roomId: string,
  deliberation: ActiveDeliberation | null,
): void {
  getRoomVoteState(roomId).activeDeliberation = deliberation;
}

export function getActiveDeliberation(roomId: string): ActiveDeliberation | null {
  return getRoomVoteState(roomId).activeDeliberation;
}

export function clearActiveDeliberation(roomId: string): void {
  getRoomVoteState(roomId).activeDeliberation = null;
}

export function hasActiveDeliberation(roomId: string): boolean {
  return getActiveDeliberation(roomId) !== null;
}

/** True when paced deliberation is waiting for the next game-day slice. */
export function isDeliberationContinuationDue(roomId: string): boolean {
  const deliberation = getActiveDeliberation(roomId);
  if (!deliberation || deliberation.nextRoundAtGameMinute === null) {
    return false;
  }
  const state = getRoomVoteState(roomId);
  return state.absoluteGameMinute >= deliberation.nextRoundAtGameMinute;
}

export function applyDeliberationCheckpoint(
  roomId: string,
  input: Omit<ActiveDeliberation, "nextRoundAtGameMinute">,
): ActiveDeliberation {
  const state = getRoomVoteState(roomId);
  const deliberation: ActiveDeliberation = {
    ...input,
    nextRoundAtGameMinute: nextRoundAtGameMinute(state.absoluteGameMinute),
  };
  setActiveDeliberation(roomId, deliberation);
  return deliberation;
}
