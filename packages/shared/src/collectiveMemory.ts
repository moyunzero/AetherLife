import { z } from "zod";
import { bandFromEffectiveScore, clampAttitudeScore, type AttitudeBand } from "./attitude.js";
import {
  COUNCIL_PERSONALITY_SEEDS,
  personalitySeedForNpc as councilPersonalitySeedForNpc,
} from "./council/personalitySeed.js";

export const COLLECTIVE_EVENT_KINDS = [
  "rude",
  "polite",
  "help",
  "contradict",
  "compete_object",
  "collaborate",
  "steal_attempt",
  "ignore",
  "gift",
  "praise",
  "apologize",
  "betray",
] as const;

export type CollectiveEventKind = (typeof COLLECTIVE_EVENT_KINDS)[number];

export const COLLECTIVE_EVENT_SOURCES = ["rule", "llm_refine", "worker"] as const;
export type CollectiveEventSource = (typeof COLLECTIVE_EVENT_SOURCES)[number];

/** Fixed rule deltas (D-08). LLM refine uses clamp [-10, +10] separately. */
export const KIND_FIXED_DELTA: Record<CollectiveEventKind, number> = {
  rude: -8,
  polite: 3,
  help: 6,
  contradict: -10,
  compete_object: -12,
  collaborate: 8,
  steal_attempt: -15,
  ignore: -2,
  gift: 10,
  praise: 5,
  apologize: 4,
  betray: -20,
};

/** Loud kinds receive witness NPC 30% delta at Chebyshev ≤2 (D-18). */
export const LOUD_KINDS: ReadonlySet<CollectiveEventKind> = new Set([
  "rude",
  "contradict",
  "steal_attempt",
  "compete_object",
  "betray",
]);

/** NPC personality seeds on first upsert (D-17) — derived from council registry (D-COLLECTIVE-01). */
export const NPC_PERSONALITY_SEED: Record<string, number> = { ...COUNCIL_PERSONALITY_SEEDS };

export const DEFAULT_COLLECTIVE_WINDOW_MS = 300_000;
export const COLLECTIVE_EVENT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const COLLECTIVE_WINDOW_MEAN_WEIGHT = 0.3;
export const WITNESS_DELTA_FRACTION = 0.3;
export const WITNESS_CHEBYSHEV_MAX = 2;
export const LLM_REFINE_DELTA_MIN = -10;
export const LLM_REFINE_DELTA_MAX = 10;

export type CollectivePosition = { x: number; y: number };

export type CollectiveEventInput = {
  roomId: string;
  npcId: string;
  kind: CollectiveEventKind;
  summary: string;
  playerIds: string[];
  deltaScore: number;
  source?: CollectiveEventSource;
  createdAt?: Date;
};

const collectiveEventKindSchema = z.enum(COLLECTIVE_EVENT_KINDS);
const collectiveEventSourceSchema = z.enum(COLLECTIVE_EVENT_SOURCES);

export const collectiveEventSchema = z.object({
  roomId: z.string().min(1),
  npcId: z.string().min(1),
  kind: collectiveEventKindSchema,
  summary: z.string().min(1).max(500),
  playerIds: z.array(z.string().min(1)).min(1),
  deltaScore: z.number().int().min(-100).max(100),
  source: collectiveEventSourceSchema.default("rule"),
  createdAt: z.coerce.date().optional(),
});

export type ParsedCollectiveEvent = z.infer<typeof collectiveEventSchema>;

export function parseCollectiveEvent(input: unknown): ParsedCollectiveEvent {
  return collectiveEventSchema.parse(input);
}

export function safeParseCollectiveEvent(input: unknown) {
  return collectiveEventSchema.safeParse(input);
}

export function fixedDeltaForKind(kind: CollectiveEventKind): number {
  return KIND_FIXED_DELTA[kind];
}

export function clampLlmRefineDelta(delta: number): number {
  return Math.max(LLM_REFINE_DELTA_MIN, Math.min(LLM_REFINE_DELTA_MAX, Math.round(delta)));
}

export { councilPersonalitySeedForNpc as personalitySeedForNpc };

export function chebyshev(a: CollectivePosition, b: CollectivePosition): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/** D-16: effectiveScore = clamp(playerRep + 0.3 × windowMean, -100, 100). */
export function computeEffectiveScore(
  initiatorRep: number,
  windowDeltas: readonly number[],
): number {
  const mean =
    windowDeltas.length === 0
      ? 0
      : windowDeltas.reduce((sum, d) => sum + d, 0) / windowDeltas.length;
  return clampAttitudeScore(initiatorRep + COLLECTIVE_WINDOW_MEAN_WEIGHT * mean);
}

export function effectiveBand(initiatorRep: number, windowDeltas: readonly number[]): AttitudeBand {
  return bandFromEffectiveScore(computeEffectiveScore(initiatorRep, windowDeltas));
}

export type WitnessDeltaUpdate = {
  npcId: string;
  playerId: string;
  delta: number;
};

/** Apply target 100% + witness 30% for loud kinds (D-18). */
export function computeWitnessDeltas(
  event: Pick<CollectiveEventInput, "kind" | "deltaScore" | "playerIds">,
  targetNpcId: string,
  npcPositions: ReadonlyMap<string, CollectivePosition>,
): WitnessDeltaUpdate[] {
  const updates: WitnessDeltaUpdate[] = [];
  const targetPos = npcPositions.get(targetNpcId);

  for (const playerId of event.playerIds) {
    updates.push({ npcId: targetNpcId, playerId, delta: event.deltaScore });

    if (!LOUD_KINDS.has(event.kind) || !targetPos) continue;

    for (const [witnessId, pos] of npcPositions) {
      if (witnessId === targetNpcId) continue;
      if (chebyshev(pos, targetPos) > WITNESS_CHEBYSHEV_MAX) continue;
      updates.push({
        npcId: witnessId,
        playerId,
        delta: Math.round(event.deltaScore * WITNESS_DELTA_FRACTION),
      });
    }
  }

  return updates;
}

export function collectiveWindowMsFromEnv(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_COLLECTIVE_WINDOW_MS;
}
