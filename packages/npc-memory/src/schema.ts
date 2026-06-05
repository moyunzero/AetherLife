import { customType, index, pgTable, real, text, timestamp, uuid } from "drizzle-orm/pg-core";

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
    npcId: text("npc_id").notNull().default("1"),
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
    npcId: text("npc_id").notNull().default("1"),
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
