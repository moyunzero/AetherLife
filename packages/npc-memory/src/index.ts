export { createDb, getSharedDb, getSharedSql, resetSharedDbForTests, type Db } from "./db.js";
export {
  computeWeightedScore,
  MemoryRepository,
  type AppendMemoryInput,
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
  type CollectiveEventRow,
  type InsertCollectiveEventInput,
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
