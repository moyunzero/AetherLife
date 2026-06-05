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

/** Weighted retrieval score from 03-RESEARCH.md */
export function computeWeightedScore(cosineSimilarity: number, importance: number): number {
  const factor = 0.5 + (importance || 5) / 20;
  return cosineSimilarity * factor;
}

export class MemoryRepository {
  constructor(private readonly db: Db) {}

  async appendMemory(input: AppendMemoryInput): Promise<string> {
    const npcId = input.npcId ?? "1";
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

  async searchSimilar(input: {
    roomId: string;
    playerId: string;
    npcId?: string;
    queryEmbedding: number[];
    k?: number;
  }): Promise<SimilarMemory[]> {
    const npcId = input.npcId ?? "1";
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
    const npcId = input.npcId ?? "1";
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
    const npcId = input.npcId ?? "1";
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
    const npcId = input.npcId ?? "1";
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
    const npcId = input.npcId ?? "1";
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
    const npcId = input.npcId ?? "1";
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
