export const PACKAGE_SCOPE = "@aetherlife" as const;

export const DEFAULT_PORTS = {
  web: 5173,
  gameServer: 2567,
  aiGateway: 8000,
} as const;

export {
  createDefaultRoom,
  findNpc,
  type GameObject,
  type NpcState,
  type ObjectState,
  type PlayerState,
  type RoomState,
} from "./room.js";

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
  type ColyseusSpeakBusyPayload,
  type ColyseusSpeakIdlePayload,
  type ColyseusSpeakPayload,
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
  LEGACY_PLAYER_ID,
  PLAYER_ID_HEADER,
  PLAYER_ID_STORAGE_KEY,
  TAB_PRESENCE_CHANNEL,
  isValidPlayerId,
  normalizePlayerId,
  resolvePlayerId,
} from "./player.js";
