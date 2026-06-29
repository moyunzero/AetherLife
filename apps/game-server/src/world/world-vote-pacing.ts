/** Deliberation pacing env helpers (Phase 25 plan 09, D-REL-V2-03). */

export const GAME_DAY_MINUTES = 1440;
const DEFAULT_DEBATE_ROUNDS_MAX = 5;
const DEFAULT_DEBATE_ROUND_GAME_DAYS = 1;

export function debateRoundsCap(): number {
  const raw = process.env.VOTE_DEBATE_ROUNDS_MAX;
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return DEFAULT_DEBATE_ROUNDS_MAX;
}

/** Clamp requested debate rounds to env cap (default max 5). */
export function capDebateRoundsMax(requested: number): number {
  const cap = debateRoundsCap();
  const n = Number.isFinite(requested) ? Math.floor(requested) : 2;
  return Math.max(1, Math.min(cap, n));
}

/** Default true — all debate rounds + ballot in one worker job (UAT / dev). */
export function resolveInstantDebate(): boolean {
  const raw = process.env.VOTE_INSTANT_DEBATE;
  if (raw === undefined || raw === "") return true;
  return raw === "1" || raw.toLowerCase() === "true";
}

export function debateRoundGameDays(): number {
  const raw = process.env.VOTE_DEBATE_ROUND_GAME_DAYS;
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return DEFAULT_DEBATE_ROUND_GAME_DAYS;
}

export function nextRoundAtGameMinute(currentGameMinute: number): number {
  return currentGameMinute + debateRoundGameDays() * GAME_DAY_MINUTES;
}
