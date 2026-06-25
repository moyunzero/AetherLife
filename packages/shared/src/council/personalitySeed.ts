import { clampAttitudeScore } from "../attitude.js";
import { COUNCIL_NPC_IDS, getPersona, isCouncilNpcId } from "./constants.js";
import type { CouncilArchetype, VotingLeaning } from "./types.js";

/** Base offset from registry votingLeaning (D-COLLECTIVE-01). */
const LEANING_BASE: Record<VotingLeaning, number> = {
  against: -40,
  swing: 0,
  for: 40,
};

/** Archetype modifier layered on leaning base (D-COLLECTIVE-01). */
const ARCHETYPE_DELTA: Record<CouncilArchetype, number> = {
  order_keeper: -12,
  expansionist: 18,
  logician: 0,
  chaos_agent: 8,
  pacifist: -5,
  power_broker: -15,
  mediator: 3,
  guardian: -10,
  aesthete: 2,
  brawler: 15,
  perfectionist: -8,
  explorer: 12,
};

/** Precomputed seeds for all 12 council seats — sync to Python constants.py. */
export const COUNCIL_PERSONALITY_SEEDS: Record<string, number> = Object.fromEntries(
  COUNCIL_NPC_IDS.map((id) => [id, personalitySeedFromPersona(id)]),
);

function personalitySeedFromPersona(npcId: string): number {
  const p = getPersona(npcId);
  const raw = LEANING_BASE[p.votingLeaning] + ARCHETYPE_DELTA[p.archetype];
  return clampAttitudeScore(raw);
}

/** Registry-derived personality seed; non-council ids return 0 (D-COLLECTIVE-01). */
export function personalitySeedForNpc(npcId: string): number {
  if (!isCouncilNpcId(npcId)) return 0;
  return COUNCIL_PERSONALITY_SEEDS[npcId] ?? personalitySeedFromPersona(npcId);
}
