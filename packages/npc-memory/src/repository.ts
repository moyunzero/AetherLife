import { DEFAULT_NPC_ID } from "@aetherlife/shared";
import { and, asc, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "./db.js";
import { memorySummaries, mutationAuditLogs, npcMemories, type SummaryKind } from "./schema.js";

export type SimilarMemory = {
  text: string;
  score: number;
  importance: number;
};

export type AppendMemoryInput = {
  roomId: string;
  playerId: string;
  npcId?: string;
  text: string;
  importance: number;
  embedding?: number[];
};

/** Ebbinghaus recency knobs (D-DECAY-02/02b/03). */
export type RecencyConfig = {
  /** Baseline half-life hours S₀ (default 72). */
  s0: number;
  /** Floor for recencyFactor (default 0.3). */
  floor: number;
  /** Min S when importance→0 (default 1e-3). */
  sEpsilon: number;
};

const DEFAULT_RECENCY: RecencyConfig = {
  s0: 72,
  floor: 0.3,
  sEpsilon: 1e-3,
};

function parsePositiveNumber(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

/** Read MEMORY_RECENCY_* env; invalid values → defaults. */
export function resolveRecencyConfig(env: NodeJS.ProcessEnv = process.env): RecencyConfig {
  const s0 = parsePositiveNumber(env.MEMORY_RECENCY_HALFLIFE_HOURS, DEFAULT_RECENCY.s0);
  const floorRaw = env.MEMORY_RECENCY_FLOOR;
  let floor = DEFAULT_RECENCY.floor;
  if (floorRaw !== undefined && floorRaw !== "") {
    const n = Number(floorRaw);
    if (Number.isFinite(n) && n >= 0 && n <= 1) floor = n;
  }
  const sEpsilon = parsePositiveNumber(env.MEMORY_RECENCY_S_EPSILON, DEFAULT_RECENCY.sEpsilon);
  return { s0, floor, sEpsilon };
}

/**
 * recencyFactor = max(FLOOR, exp(-ageHours × ln2 / S))
 * S = max(ε, S0 × importance/5)
 */
export function computeRecencyFactor(
  ageHours: number,
  importance: number,
  cfg: RecencyConfig = resolveRecencyConfig(),
): number {
  const S = Math.max(cfg.sEpsilon, cfg.s0 * (importance / 5));
  return Math.max(cfg.floor, Math.exp((-ageHours * Math.LN2) / S));
}

/**
 * Weighted retrieval score.
 * Two-arg: legacy cos × (0.5 + (importance||5)/20).
 * With ageHours: cos × (0.5 + importance/20) × recencyFactor (D-DECAY-01).
 */
export function computeWeightedScore(
  cosineSimilarity: number,
  importance: number,
  ageHours?: number,
  cfg?: RecencyConfig,
): number {
  if (ageHours === undefined) {
    const factor = 0.5 + (importance || 5) / 20;
    return cosineSimilarity * factor;
  }
  const importanceFactor = 0.5 + importance / 20;
  const recency = computeRecencyFactor(ageHours, importance, cfg ?? resolveRecencyConfig());
  return cosineSimilarity * importanceFactor * recency;
}

export class MemoryRepository {
  constructor(private readonly db: Db) {}

  async appendMemory(input: AppendMemoryInput): Promise<string> {
    const npcId = input.npcId ?? DEFAULT_NPC_ID;
    const rows = await this.db
      .insert(npcMemories)
      .values({
        roomId: input.roomId,
        playerId: input.playerId,
        npcId,
        text: input.text,
        importance: input.importance,
        embedding: input.embedding,
      })
      .returning({ id: npcMemories.id });
    return rows[0]!.id;
  }

  async appendMemoryBatch(inputs: AppendMemoryInput[]): Promise<string[]> {
    if (inputs.length === 0) return [];
    const rows = await this.db
      .insert(npcMemories)
      .values(
        inputs.map((input) => ({
          roomId: input.roomId,
          playerId: input.playerId,
          npcId: input.npcId ?? DEFAULT_NPC_ID,
          text: input.text,
          importance: input.importance,
          embedding: input.embedding,
        })),
      )
      .returning({ id: npcMemories.id });
    return rows.map((row) => row.id);
  }

  async updateMemoryEmbedding(id: string, embedding: number[]): Promise<void> {
    await this.db.update(npcMemories).set({ embedding }).where(eq(npcMemories.id, id));
  }

  async searchSimilar(input: {
    roomId: string;
    playerId: string;
    npcId?: string;
    queryEmbedding: number[];
    k?: number;
  }): Promise<SimilarMemory[]> {
    const npcId = input.npcId ?? DEFAULT_NPC_ID;
    const k = input.k ?? 5;
    const vectorLiteral = `[${input.queryEmbedding.join(",")}]`;

    const result = await this.db.execute(sql`
      SELECT
        text,
        importance,
        (1 - (embedding <=> ${vectorLiteral}::vector))
          * (0.5 + COALESCE(importance, 5) / 20.0) AS score
      FROM npc_memories
      WHERE room_id = ${input.roomId}
        AND player_id = ${input.playerId}
        AND npc_id = ${npcId}
        AND summarized_at IS NULL
        AND embedding IS NOT NULL
      ORDER BY score DESC
      LIMIT ${k}
    `);

    return (result as unknown as Array<{ text: string; importance: number; score: number }>).map(
      (row) => ({
        text: row.text,
        importance: Number(row.importance),
        score: Number(row.score),
      }),
    );
  }

  async countRaw(input: {
    roomId: string;
    playerId: string;
    npcId?: string;
    unsummarizedOnly?: boolean;
  }): Promise<number> {
    const npcId = input.npcId ?? DEFAULT_NPC_ID;
    const conditions = [
      eq(npcMemories.roomId, input.roomId),
      eq(npcMemories.playerId, input.playerId),
      eq(npcMemories.npcId, npcId),
    ];
    if (input.unsummarizedOnly !== false) {
      conditions.push(isNull(npcMemories.summarizedAt));
    }
    const rows = await this.db
      .select({ value: count() })
      .from(npcMemories)
      .where(and(...conditions));
    return Number(rows[0]?.value ?? 0);
  }

  async appendSummary(input: {
    roomId: string;
    playerId: string;
    npcId?: string;
    kind: SummaryKind;
    text: string;
    sourceCount?: number;
  }): Promise<string> {
    const npcId = input.npcId ?? DEFAULT_NPC_ID;
    const rows = await this.db
      .insert(memorySummaries)
      .values({
        roomId: input.roomId,
        playerId: input.playerId,
        npcId,
        kind: input.kind,
        text: input.text,
        sourceCount: input.sourceCount,
      })
      .returning({ id: memorySummaries.id });
    return rows[0]!.id;
  }

  async markSummarized(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.db
      .update(npcMemories)
      .set({ summarizedAt: new Date() })
      .where(inArray(npcMemories.id, ids));
  }

  async deleteForPlayer(input: { roomId: string; playerId: string; npcId?: string }): Promise<void> {
    const npcId = input.npcId;
    const memConditions = [
      eq(npcMemories.roomId, input.roomId),
      eq(npcMemories.playerId, input.playerId),
    ];
    const sumConditions = [
      eq(memorySummaries.roomId, input.roomId),
      eq(memorySummaries.playerId, input.playerId),
    ];
    if (npcId) {
      memConditions.push(eq(npcMemories.npcId, npcId));
      sumConditions.push(eq(memorySummaries.npcId, npcId));
    }
    await this.db.delete(npcMemories).where(and(...memConditions));
    await this.db.delete(memorySummaries).where(and(...sumConditions));
  }

  async getLatestSummaryByKind(input: {
    roomId: string;
    playerId: string;
    npcId?: string;
    kind: SummaryKind;
  }): Promise<string | null> {
    const npcId = input.npcId ?? DEFAULT_NPC_ID;
    const rows = await this.db
      .select({ text: memorySummaries.text })
      .from(memorySummaries)
      .where(
        and(
          eq(memorySummaries.roomId, input.roomId),
          eq(memorySummaries.playerId, input.playerId),
          eq(memorySummaries.npcId, npcId),
          eq(memorySummaries.kind, input.kind),
        ),
      )
      .orderBy(desc(memorySummaries.createdAt))
      .limit(1);
    return rows[0]?.text ?? null;
  }

  async getOldestUnsummarizedBatch(input: {
    roomId: string;
    playerId: string;
    npcId?: string;
    limit: number;
  }): Promise<Array<{ id: string; text: string }>> {
    const npcId = input.npcId ?? DEFAULT_NPC_ID;
    return this.db
      .select({ id: npcMemories.id, text: npcMemories.text })
      .from(npcMemories)
      .where(
        and(
          eq(npcMemories.roomId, input.roomId),
          eq(npcMemories.playerId, input.playerId),
          eq(npcMemories.npcId, npcId),
          isNull(npcMemories.summarizedAt),
        ),
      )
      .orderBy(asc(npcMemories.createdAt))
      .limit(input.limit);
  }

  async getRecentUnsummarized(input: {
    roomId: string;
    playerId: string;
    npcId?: string;
    limit: number;
  }): Promise<Array<{ id: string; text: string }>> {
    const npcId = input.npcId ?? DEFAULT_NPC_ID;
    return this.db
      .select({ id: npcMemories.id, text: npcMemories.text })
      .from(npcMemories)
      .where(
        and(
          eq(npcMemories.roomId, input.roomId),
          eq(npcMemories.playerId, input.playerId),
          eq(npcMemories.npcId, npcId),
          isNull(npcMemories.summarizedAt),
        ),
      )
      .orderBy(desc(npcMemories.createdAt))
      .limit(input.limit);
  }

  async insertMutationAudit(input: {
    roomId: string;
    npcId: string;
    jobId?: string;
    source?: string;
    actionType: string;
    actionPayload: string;
  }): Promise<string> {
    const rows = await this.db
      .insert(mutationAuditLogs)
      .values({
        roomId: input.roomId,
        npcId: input.npcId,
        jobId: input.jobId ?? null,
        source: input.source ?? "executor",
        actionType: input.actionType,
        actionPayload: input.actionPayload,
      })
      .returning({ id: mutationAuditLogs.id });
    return rows[0]!.id;
  }

  async listMutationAudits(input: {
    roomId: string;
    limit?: number;
  }): Promise<
    Array<{
      id: string;
      roomId: string;
      npcId: string;
      jobId: string | null;
      source: string;
      actionType: string;
      actionPayload: string;
      createdAt: Date;
    }>
  > {
    const limit = input.limit ?? 50;
    return this.db
      .select()
      .from(mutationAuditLogs)
      .where(eq(mutationAuditLogs.roomId, input.roomId))
      .orderBy(desc(mutationAuditLogs.createdAt))
      .limit(limit);
  }
}
