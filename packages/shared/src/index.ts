export const PACKAGE_SCOPE = "@aetherlife" as const;

export const DEFAULT_PORTS = {
  web: 5173,
  gameServer: 2567,
  aiGateway: 8000,
} as const;

export {
  BG_VILLAGER_IDS,
  DEFAULT_BACKGROUND_NPC_SPAWNS,
  backgroundNpcStatesFromSpawns,
  defaultBackgroundNpcStates,
  isBackgroundNpc,
  isBackgroundNpcId,
  type BackgroundNpcSpawn,
  type BgVillagerId,
} from "./backgroundNpc.js";

export {
  createDefaultRoom,
  findNpc,
  type GameObject,
  type NpcState,
  type ObjectState,
  type PlayerState,
  type RoomState,
} from "./room.js";
export { MAIN_NPC_DISPLAY_NAMES, mainNpcDisplayName } from "./npcDisplayNames.js";

export {
  buildMoveGrid,
  canStepTo,
  findGridPath,
  findNearestWalkableCell,
  type BuildMoveGridOptions,
  type GridCell,
  type MoveGrid,
} from "./pathfind.js";

export {
  CHUNK_SIZE,
  chunkKey,
  chunkOf,
  floorMod,
  globalCell,
  localInChunk,
} from "./world.js";

export {
  HOME_DEFAULT_PLAYER_SPAWN,
  HOME_MAP_TILE_H,
  HOME_MAP_TILE_W,
  HOME_NPC_SPAWNS,
  HOME_SPAWN_CONFIG_VERSION,
  homeDefaultPlayerSpawn,
  homeNpcSpawn,
  isHomeMapRegionCell,
  type HomeNpcId,
} from "./homeMap.js";

export {
  assertRegionsNonOverlapping,
  BEGINNING_FIELDS_ID,
  VILLAGE_PLAZA_ID,
  defaultBeginningFieldsBundle,
  defaultWorldRegistryBundle,
  fromLocal,
  getRegionById,
  getWorldRegistry,
  loadWorldRegistry,
  parseZoneId,
  regionAt,
  setWorldRegistry,
  toGlobal,
  zoneAtLocal,
  type Poi,
  type CouncilSpawnEntry,
  type RegionSpawns,
  type WorldRegion,
  type WorldRegionId,
  type WorldRegistry,
  type WorldRegistryBundle,
  type Zone,
  type ZoneId,
  type ZoneRect,
} from "./worldRegion.js";

export {
  BIOME_LABEL_ZH,
  chunkViewsFingerprint,
  type BiomeId,
  type ChunkBase,
  type ChunkBaseTile,
  type ChunkDelta,
  type ChunkTileView,
  type ChunkView,
} from "./chunk.js";

export {
  biomeAtGlobal,
  biomeFromNoise,
  createWorldNoise2D,
  generateChunkBase,
  homeChunkTile,
  type BiomeTile,
} from "./chunkProcedural.js";

export {
  clientPredictOrigin,
  leadingVisualAfterAck,
  nextServerStepTarget,
  reconcileMoveAck,
  type MoveAckInput,
  type MoveAckReconcileResult,
  type PendingMove,
} from "./moveAck.js";

export {
  shouldSuppressLocalSchemaSnap,
  type LocalSchemaSnapInput,
} from "./localPlayerSchemaSnap.js";

export {
  buildGlobalMoveGrid,
  canStepGlobal,
  defaultSpawnGlobal,
  findGlobalGridPath,
  findNearestGlobalWalkable,
  isHomeChunkCell,
  type BuildGlobalMoveGridOptions,
  type GlobalMoveGrid,
} from "./globalPathfind.js";

export {
  COLYSEUS_CLIENT_MESSAGES,
  COLYSEUS_MAX_CLIENTS,
  COLYSEUS_ORPHAN_SHARD_WS_CODE,
  COLYSEUS_ROOM_FULL_CODE,
  COLYSEUS_ROOM_FULL_WS_CODE,
  COLYSEUS_ROOM_NAME,
  COLYSEUS_SERVER_MESSAGES,
  type ChunkLorePublic,
  type ChunkLoreStatus,
  type ColyseusChunksSyncPayload,
  type ColyseusLoreSyncPayload,
  type ColyseusMoveAckPayload,
  type ColyseusMovePayload,
  type ColyseusNpcJobDonePayload,
  type ColyseusSpeakPartialPayload,
  type ColyseusSpeakBusyPayload,
  type ColyseusSpeakIdlePayload,
  type ColyseusSpeakPayload,
  type ColyseusWorldHistorySyncPayload,
  type Facing,
  type StatePatchNpcDelta,
  type StatePatchPayload,
} from "./colyseus.js";

export {
  CHUNK_LORE_BIOME_ENUM,
  ChunkLoreSchema,
  parseChunkLore,
  safeParseChunkLore,
  validateChunkLoreStrings,
  type ChunkLore,
} from "./chunkLoreSchema.js";

export {
  AmbientIntentSchema,
  AmbientIntentTargetSchema,
  AmbientIntentZoneSchema,
  isTargetIntent,
  isZoneIntent,
  parseAmbientIntent,
  safeParseAmbientIntent,
  type AmbientIntent,
  type AmbientIntentTarget,
  type AmbientIntentZone,
} from "./ambientIntentSchema.js";

export {
  dominantBiomeFromTiles,
  loreJobId,
  lorePendingRedisKey,
  lorePlayerDiscoveriesRedisKey,
  walkableRatioFromTiles,
} from "./chunkLore.js";

export { HOME_CHUNK_LORE, toChunkLorePublic } from "./worldLore.js";

export { sanitizeNpcReplyText } from "./npcReply.js";

export {
  CONTENT_BLOCKED_CODE,
  CONTENT_BLOCKED_MESSAGE,
  MAX_PLAYER_MESSAGE_LEN,
  checkPlayerMessageContent,
  contentBlockedPayload,
  type ContentCheckResult,
} from "./contentGuard.js";

export {
  DEFAULT_NPC_ID,
  LEGACY_DEFAULT_NPC_ID,
  LEGACY_PLAYER_ID,
  PLAYER_ID_HEADER,
  PLAYER_ID_STORAGE_KEY,
  TAB_PRESENCE_CHANNEL,
  isValidPlayerId,
  normalizePlayerId,
  resolvePlayerId,
} from "./player.js";

export {
  ATTITUDE_SCORE_MAX,
  ATTITUDE_SCORE_MIN,
  bandFromEffectiveScore,
  bandLabelZh,
  clampAttitudeScore,
  type AttitudeBand,
} from "./attitude.js";

export {
  NPC_ACTIVITY_KEYS,
  NPC_ACTIVITY_LABEL_ZH,
  activityDisplayZh,
  formatGameClock,
  isKnownActivityKey,
  type NpcActivityKey,
} from "./npcActivity.js";

export { isReasonZhRedundantWithActivity } from "./intentContent.js";

export { stableStringHash } from "./stableStringHash.js";

export {
  SpeakIntent,
  classifySpeakIntent,
  inferSocialFromMessage,
  isRecallQuestion,
  playerRequestsPhysicalAction,
  playerRequestsInteract,
  playerRequestsMove,
  shouldSkipMemoryContext,
  type SpeakIntentValue,
} from "./speakIntent.js";

export {
  canUseCasualFastLane,
  pickCasualReply,
  previewCasualSpeakStub,
  type CasualFastLanePreview,
} from "./casualSpeakStub.js";

export {
  COLLECTIVE_EVENT_KINDS,
  COLLECTIVE_EVENT_SOURCES,
  COLLECTIVE_EVENT_TTL_MS,
  COLLECTIVE_WINDOW_MEAN_WEIGHT,
  DEFAULT_COLLECTIVE_WINDOW_MS,
  KIND_FIXED_DELTA,
  LLM_REFINE_DELTA_MAX,
  LLM_REFINE_DELTA_MIN,
  LOUD_KINDS,
  NPC_PERSONALITY_SEED,
  WITNESS_CHEBYSHEV_MAX,
  WITNESS_DELTA_FRACTION,
  clampLlmRefineDelta,
  chebyshev,
  collectiveEventSchema,
  collectiveWindowMsFromEnv,
  computeEffectiveScore,
  computeWitnessDeltas,
  effectiveBand,
  fixedDeltaForKind,
  parseCollectiveEvent,
  personalitySeedForNpc,
  safeParseCollectiveEvent,
  type CollectiveEventInput,
  type CollectiveEventKind,
  type CollectiveEventSource,
  type CollectivePosition,
  type ParsedCollectiveEvent,
  type WitnessDeltaUpdate,
} from "./collectiveMemory.js";

export {
  AETHER_CALENDAR_EPOCH_YEAR,
  AETHER_SEASONS,
  DAYS_PER_MONTH,
  DAYS_PER_YEAR,
  MINUTES_PER_DAY,
  NPC_PERSONAL_TIMELINE_TABLE,
  PERSONAL_TIMELINE_TAGS,
  aetherCivilFromEpochMinute,
  computeProposalEligible,
  formatAetherCalendarLabel,
  validatePersonalTimelineStrings,
  type AetherCalendarLabel,
  type AetherCivilDate,
  type AetherSeason,
  type PersonalTimelineEntry,
  type PersonalTimelineEventAnchor,
  type PersonalTimelineSource,
  type PersonalTimelineTag,
} from "./personalTimeline.js";

export {
  AETHER_NEXUS_LORE,
  BEGINNING_FIELDS_NAME_EN,
  BEGINNING_FIELDS_NAME_ZH,
  aetherNexusSummaryForPrompt,
  type AetherNexusLore,
} from "./aetherNexusLore.js";

export {
  COUNCIL_MEMORY_PLAYER_ID,
  COUNCIL_NPC_IDS,
  COUNCIL_PERSONAS,
  formatPersonaPromptBlock,
  getPersona,
  isCouncilNpcId,
  parseCouncilPersona,
  safeParseCouncilPersona,
  SPEAK_PROMPT_CHAR_BUDGET,
  type CouncilArchetype,
  type CouncilLifeNode,
  type CouncilNpcId,
  type CouncilPersona,
  type CouncilRelationship,
  type VotingLeaning,
} from "./npcPersonas.js";

export { relationshipKindLabelZh } from "./council/relationshipLabels.js";

export {
  getCouncilSpawnSlots,
  shuffleCouncilSpawnAssignments,
  type CouncilSpawnAssignment,
  type CouncilSpawnSlot,
} from "./council/spawn.js";

export {
  migrateRoomCouncilNpcs,
  type CouncilRoomMigrationResult,
} from "./council/migrate.js";

export {
  ARCHETYPE_CHANGE_RATE,
  RELATIONSHIP_AFFECTION_MAX,
  RELATIONSHIP_AFFECTION_MIN,
  RELATIONSHIP_DELTA_ABS_MAX,
  changeRateForArchetype,
  clampAffection,
  clampDeltaMagnitude,
  clampTrust,
  initialAffectionFromKind,
  initialTrustFromAffection,
  linkedEdgeSchema,
  normalizeEdgeIds,
  councilIndexEdgeIds,
  parseRelationshipDeltaInput,
  relationshipDeltaInputSchema,
  safeParseRelationshipDeltaInput,
  type LinkedEdge,
  type RelationshipDeltaInput,
  type RelationshipEdgePublic,
} from "./councilRelationships.js";

export {
  councilDeliberationFeedRowSchema,
  councilDeliberationPhaseSchema,
  councilDeliberationSyncPayloadSchema,
  councilDeliberationVoteKindSchema,
  parseCouncilDeliberationFeedRow,
  parseCouncilDeliberationPhase,
  parseCouncilDeliberationSyncPayload,
  safeParseCouncilDeliberationSyncPayload,
  type CouncilDeliberationFeedRow,
  type CouncilDeliberationPhase,
  type CouncilDeliberationPublicState,
  type CouncilDeliberationVoteKind,
} from "./councilDeliberation.js";

export {
  chronicleGameYearFromMinute,
  formatChronicleYearLabel,
  toWorldHistoryListEntry,
  genesisMinutesSchema,
  genesisSignatorySchema,
  parseWorldHistoryMinutes,
  parseWorldHistoryStatusFilter,
  safeParseWorldHistoryMinutes,
  validateWorldHistoryStrings,
  voteBallotSchema,
  debateExcerptSchema,
  voteMinutesSchema,
  worldHistoryMinutesSchema,
  type DebateExcerpt,
  type GenesisMinutes,
  type GenesisSignatory,
  type VoteBallot,
  type VoteMinutes,
  type WorldHistoryEntryKind,
  type WorldHistoryMinutes,
  type WorldHistoryListEntry,
  type WorldHistoryPublicEntry,
  type WorldHistoryStatus,
  type WorldHistoryStatusFilter,
} from "./worldHistory.js";
