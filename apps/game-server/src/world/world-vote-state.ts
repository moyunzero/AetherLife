import type { CouncilDeliberationVoteKind } from "@aetherlife/shared";

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
