export { createDb, getSharedDb, getSharedSql, resetSharedDbForTests, type Db } from "./db.js";
export {
  computeRecencyFactor,
  computeWeightedScore,
  resolveRecencyConfig,
  MemoryRepository,
  type AppendMemoryInput,
  type RecencyConfig,
  type SimilarMemory,
} from "./repository.js";
export {
  EMBED_DIMENSIONS,
  npcMemories,
  memorySummaries,
  mutationAuditLogs,
  collectiveEvents,
  npcAttitudes,
  npcPersonalTimeline,
  type SummaryKind,
  type CollectiveEventKind,
  type CollectiveEventSource,
} from "./schema.js";
export {
  CollectiveRepository,
  createCollectiveRepository,
  type AttitudeRow,
  type CollectiveEventRow,
  type InsertCollectiveEventInput,
  type SemanticStatePatch,
} from "./collective/repository.js";
export {
  COLLECTIVE_EVENT_TTL_MS,
  COLLECTIVE_WINDOW_MEAN_WEIGHT,
  DEFAULT_COLLECTIVE_WINDOW_MS,
  WITNESS_CHEBYSHEV_MAX,
  WITNESS_DELTA_FRACTION,
  computeEffectiveScore,
  computeWitnessDeltas,
  effectiveBand,
  type CollectiveEventInput,
  type WitnessDeltaUpdate,
} from "./collective/scoring.js";
