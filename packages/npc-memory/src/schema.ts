import {
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import {
  DEFAULT_NPC_ID,
  type CollectiveEventKind,
  type CollectiveEventSource,
} from "@aetherlife/shared";

/** Matches nvidia/llama-nemotron-embed-vl-1b-v2:free (see docs/phase3-embed-spike.md). */
export const EMBED_DIMENSIONS = 2048;

const vector2048 = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return `vector(${EMBED_DIMENSIONS})`;
  },
  toDriver(value: number[]): string {
    return `[${value.join(",")}]`;
  },
});

export const npcMemories = pgTable(
  "npc_memories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roomId: text("room_id").notNull(),
    playerId: text("player_id").notNull().default("__legacy__"),
    npcId: text("npc_id").notNull().default(DEFAULT_NPC_ID),
    text: text("text").notNull(),
    importance: real("importance").notNull().default(5),
    embedding: vector2048("embedding"),
    summarizedAt: timestamp("summarized_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("npc_memories_room_player_npc_created").on(
      table.roomId,
      table.playerId,
      table.npcId,
      table.createdAt,
    ),
  ],
);

export const memorySummaries = pgTable(
  "memory_summaries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roomId: text("room_id").notNull(),
    playerId: text("player_id").notNull().default("__legacy__"),
    npcId: text("npc_id").notNull().default(DEFAULT_NPC_ID),
    kind: text("kind").notNull(),
    text: text("text").notNull(),
    sourceCount: real("source_count"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("memory_summaries_room_player_npc_created").on(
      table.roomId,
      table.playerId,
      table.npcId,
      table.createdAt,
    ),
  ],
);

export type SummaryKind = "reflection" | "bulk";

export type { CollectiveEventKind, CollectiveEventSource };

export const collectiveEvents = pgTable(
  "collective_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roomId: text("room_id").notNull(),
    npcId: text("npc_id").notNull(),
    kind: text("kind").notNull().$type<CollectiveEventKind>(),
    summary: text("summary").notNull(),
    playerIds: text("player_ids").array().notNull(),
    deltaScore: integer("delta_score").notNull(),
    source: text("source").notNull().default("rule").$type<CollectiveEventSource>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("collective_events_room_npc_created_idx").on(
      table.roomId,
      table.npcId,
      table.createdAt,
    ),
    index("collective_events_room_created_idx").on(table.roomId, table.createdAt),
  ],
);

export const npcAttitudes = pgTable(
  "npc_attitudes",
  {
    roomId: text("room_id").notNull(),
    npcId: text("npc_id").notNull(),
    playerId: text("player_id").notNull(),
    reputation: integer("reputation").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.roomId, table.npcId, table.playerId] }),
    index("npc_attitudes_room_player_idx").on(table.roomId, table.playerId),
  ],
);

export const mutationAuditLogs = pgTable(
  "mutation_audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roomId: text("room_id").notNull(),
    npcId: text("npc_id").notNull(),
    jobId: text("job_id"),
    source: text("source").notNull().default("executor"),
    actionType: text("action_type").notNull(),
    actionPayload: text("action_payload").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("mutation_audit_logs_room_created").on(table.roomId, table.createdAt),
  ],
);

export const npcLeaningDrift = pgTable(
  "npc_leaning_drift",
  {
    roomId: text("room_id").notNull(),
    npcId: text("npc_id").notNull(),
    drift: integer("drift").notNull().default(0),
    dayBucketApplied: integer("day_bucket_applied").notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.roomId, table.npcId] }),
    index("npc_leaning_drift_room_idx").on(table.roomId),
  ],
);

export const npcRelationships = pgTable(
  "npc_relationships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roomId: text("room_id").notNull(),
    npcAId: text("npc_a_id").notNull(),
    npcBId: text("npc_b_id").notNull(),
    baseTag: text("base_tag").notNull(),
    affection: integer("affection").notNull().default(0),
    trust: integer("trust").notNull().default(50),
    interactionCount: integer("interaction_count").notNull().default(0),
    lastInteractAt: timestamp("last_interact_at", { withTimezone: true }),
    currentStatus: jsonb("current_status").notNull().default([]),
    historySummary: text("history_summary").notNull().default(""),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("npc_relationships_room_idx").on(table.roomId),
    index("npc_relationships_room_npc_a_idx").on(table.roomId, table.npcAId),
    index("npc_relationships_room_npc_b_idx").on(table.roomId, table.npcBId),
  ],
);
