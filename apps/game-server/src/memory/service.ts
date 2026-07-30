import {
  computeWeightedScore,
  createDb,
  MemoryRepository,
  type SimilarMemory,
  type SummaryKind,
} from "@aetherlife/npc-memory";
import { clampSemanticState, COUNCIL_MEMORY_PLAYER_ID } from "@aetherlife/shared";
import { embedText } from "./embed.js";
import { scoreImportance } from "./importance.js";
import type { CollectiveContext } from "../collective/service.js";
import { CollectiveService } from "../collective/service.js";

const COUNCIL_VOTE_MEMORY_MARKER = "廷议表决";

function councilRecentAsRetrieved(
  rows: Array<{ text: string }>,
  importance = 0.6,
): SimilarMemory[] {
  return rows
    .filter((row) => row.text.includes(COUNCIL_VOTE_MEMORY_MARKER))
    .map((row) => ({
      text: row.text,
      score: 0.55 * (0.5 + importance / 20),
      importance,
    }));
}

function mergeRetrievedMemories(
  vectorResults: SimilarMemory[],
  recentResults: SimilarMemory[],
  k = 5,
): SimilarMemory[] {
  const seen = new Set<string>();
  const merged: SimilarMemory[] = [];
  for (const item of [...vectorResults, ...recentResults]) {
    if (seen.has(item.text)) continue;
    seen.add(item.text);
    merged.push(item);
    if (merged.length >= k) break;
  }
  return merged.sort((a, b) => b.score - a.score);
}

export type MemoryContext = {
  memoryCount: number;
  retrieved: SimilarMemory[];
  latestBulkSummary: string | null;
  latestReflection: string | null;
  timingMs: number;
  collective: CollectiveContext;
};

export type NpcMemoryDebug = {
  memoryCount: number;
  latestBulkSummary: string | null;
  latestReflection: string | null;
};

type MemoryRow = {
  id: string;
  roomId: string;
  playerId: string;
  npcId: string;
  text: string;
  importance: number;
  embedding: number[];
  summarizedAt: Date | null;
  createdAt: Date;
};

type SummaryRow = {
  id: string;
  roomId: string;
  playerId: string;
  npcId: string;
  kind: SummaryKind;
  text: string;
  sourceCount: number | null;
  createdAt: Date;
};

/** In-memory backend for vitest when DATABASE_URL is unset. */
class TestMemoryBackend {
  private memories: MemoryRow[] = [];
  private summaries: SummaryRow[] = [];
  private seq = 0;

  private nextId() {
    this.seq += 1;
    return `test-${this.seq}`;
  }

  async appendMemory(input: {
    roomId: string;
    playerId: string;
    npcId: string;
    text: string;
    importance: number;
    embedding?: number[];
    createdAt?: Date;
  }) {
    const id = this.nextId();
    this.memories.push({
      id,
      roomId: input.roomId,
      playerId: input.playerId,
      npcId: input.npcId,
      text: input.text,
      importance: input.importance,
      embedding: input.embedding ?? [],
      summarizedAt: null,
      createdAt: input.createdAt ?? new Date(),
    });
    return id;
  }

  async updateMemoryEmbedding(id: string, embedding: number[]) {
    const row = this.memories.find((m) => m.id === id);
    if (row) row.embedding = embedding;
  }

  async appendMemoryBatch(
    inputs: Array<{
      roomId: string;
      playerId: string;
      npcId: string;
      text: string;
      importance: number;
      embedding?: number[];
    }>,
  ) {
    const ids: string[] = [];
    for (const input of inputs) {
      ids.push(await this.appendMemory(input));
    }
    return ids;
  }

  async searchSimilar(input: {
    roomId: string;
    playerId: string;
    npcId: string;
    queryEmbedding: number[];
    k: number;
  }): Promise<SimilarMemory[]> {
    const dot = (a: number[], b: number[]) =>
      a.reduce((sum, v, i) => sum + v * (b[i] ?? 0), 0);
    const norm = (v: number[]) => Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
    const now = Date.now();

    return this.memories
      .filter(
        (m) =>
          m.roomId === input.roomId &&
          m.playerId === input.playerId &&
          m.npcId === input.npcId &&
          !m.summarizedAt &&
          m.embedding.length > 0,
      )
      .map((m) => {
        const sim =
          dot(m.embedding, input.queryEmbedding) /
          (norm(m.embedding) * norm(input.queryEmbedding));
        const ageHours = (now - m.createdAt.getTime()) / 3_600_000;
        const score = computeWeightedScore(sim, m.importance, ageHours);
        return { text: m.text, score, importance: m.importance };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, input.k);
  }

  async countRaw(roomId: string, playerId: string, npcId: string) {
    return this.memories.filter(
      (m) =>
        m.roomId === roomId &&
        m.playerId === playerId &&
        m.npcId === npcId &&
        !m.summarizedAt,
    ).length;
  }

  async appendSummary(input: {
    roomId: string;
    playerId: string;
    npcId: string;
    kind: SummaryKind;
    text: string;
    sourceCount?: number;
  }) {
    const id = this.nextId();
    this.summaries.push({
      id,
      roomId: input.roomId,
      playerId: input.playerId,
      npcId: input.npcId,
      kind: input.kind,
      text: input.text,
      sourceCount: input.sourceCount ?? null,
      createdAt: new Date(),
    });
    return id;
  }

  async markSummarized(ids: string[]) {
    for (const row of this.memories) {
      if (ids.includes(row.id)) row.summarizedAt = new Date();
    }
  }

  async deleteForPlayer(roomId: string, playerId: string, npcId?: string) {
    this.memories = this.memories.filter(
      (m) =>
        !(m.roomId === roomId && m.playerId === playerId && (!npcId || m.npcId === npcId)),
    );
    this.summaries = this.summaries.filter(
      (s) =>
        !(s.roomId === roomId && s.playerId === playerId && (!npcId || s.npcId === npcId)),
    );
  }

  latestSummary(roomId: string, playerId: string, npcId: string, kind: SummaryKind) {
    const rows = this.summaries
      .filter(
        (s) =>
          s.roomId === roomId && s.playerId === playerId && s.npcId === npcId && s.kind === kind,
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return rows[0]?.text ?? null;
  }

  oldestBatch(roomId: string, playerId: string, npcId: string, limit: number) {
    return this.memories
      .filter(
        (m) =>
          m.roomId === roomId && m.playerId === playerId && m.npcId === npcId && !m.summarizedAt,
      )
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .slice(0, limit)
      .map((m) => ({ id: m.id, text: m.text }));
  }

  recentBatch(roomId: string, playerId: string, npcId: string, limit: number) {
    return this.memories
      .filter(
        (m) =>
          m.roomId === roomId && m.playerId === playerId && m.npcId === npcId && !m.summarizedAt,
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit)
      .map((m) => ({ id: m.id, text: m.text }));
  }

  private audits: Array<{
    id: string;
    roomId: string;
    npcId: string;
    jobId: string | null;
    source: string;
    actionType: string;
    actionPayload: string;
    createdAt: Date;
  }> = [];

  async insertMutationAudit(input: {
    roomId: string;
    npcId: string;
    jobId?: string;
    actionType: string;
    actionPayload: string;
  }): Promise<void> {
    this.seq += 1;
    this.audits.push({
      id: `audit-${this.seq}`,
      roomId: input.roomId,
      npcId: input.npcId,
      jobId: input.jobId ?? null,
      source: "executor",
      actionType: input.actionType,
      actionPayload: input.actionPayload,
      createdAt: new Date(),
    });
  }

  listMutationAudits(roomId: string, limit: number) {
    return this.audits
      .filter((a) => a.roomId === roomId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }
}

let instance: MemoryService | null = null;
let testBackend: TestMemoryBackend | null = null;

export class MemoryService {
  private readonly repo: MemoryRepository | null;
  private readonly test: TestMemoryBackend | null;

  private constructor(repo: MemoryRepository | null, test: TestMemoryBackend | null) {
    this.repo = repo;
    this.test = test;
  }

  static getInstance(): MemoryService {
    if (instance) return instance;

    const url = process.env.DATABASE_URL;
    if (!url) {
      if (process.env.VITEST === "true") {
        testBackend = new TestMemoryBackend();
        instance = new MemoryService(null, testBackend);
        return instance;
      }
      throw new Error("DATABASE_URL is required for Phase 3 memory persistence");
    }

    const db = createDb(url);
    instance = new MemoryService(new MemoryRepository(db), null);
    return instance;
  }

  /** @internal */
  static resetForTests(): void {
    instance = null;
    testBackend = null;
  }

  /** @internal vitest helper — seed row with explicit createdAt/embedding. */
  async seedMemoryForTests(input: {
    roomId: string;
    playerId: string;
    npcId: string;
    text: string;
    importance: number;
    embedding: number[];
    createdAt: Date;
  }): Promise<void> {
    if (!this.test) {
      throw new Error("seedMemoryForTests requires TestMemoryBackend");
    }
    await this.test.appendMemory(input);
  }

  async appendPlayerMemory(
    roomId: string,
    text: string,
    npcId: string,
    playerId: string,
    importance?: number,
  ): Promise<void> {
    const line = text.startsWith("player:") ? text : `player: ${text}`;
    const score = importance ?? (await scoreImportance(line));
    const embedding = await embedText(line);
    await this.append({ roomId, playerId, npcId, text: line, importance: score, embedding });
  }

  async appendNpcMemory(
    roomId: string,
    text: string,
    npcId: string,
    playerId: string,
    importance?: number,
    options?: { skipEmbed?: boolean },
  ): Promise<void> {
    const line = text.startsWith("npc:") ? text : `npc: ${text}`;
    const score = importance ?? (await scoreImportance(line));
    const embedding = options?.skipEmbed === true ? undefined : await embedText(line);
    await this.append({ roomId, playerId, npcId, text: line, importance: score, embedding });
  }

  /** Bulk council vote tail: fast insert then parallel embed (Phase 25 writeback). */
  async appendCouncilVoteMemories(
    roomId: string,
    ballots: Array<{ npcId: string; vote: string; reasonZh: string }>,
  ): Promise<{ count: number }> {
    const playerId = COUNCIL_MEMORY_PLAYER_ID;
    const rows = ballots.map((ballot) => ({
      roomId,
      playerId,
      npcId: ballot.npcId,
      text: `npc: 廷议表决：${ballot.vote} — ${ballot.reasonZh}`,
      importance: 0.6,
    }));
    if (rows.length === 0) {
      return { count: 0 };
    }

    let ids: string[];
    if (this.test) {
      ids = await this.test.appendMemoryBatch(rows);
    } else {
      ids = await this.repo!.appendMemoryBatch(rows);
    }

    await this.embedMemoryRows(ids, rows.map((row) => row.text));
    return { count: ids.length };
  }

  private async embedMemoryRows(ids: string[], texts: string[]): Promise<void> {
    const concurrency = 3;
    const maxAttempts = 3;
    const failures: string[] = [];

    for (let offset = 0; offset < ids.length; offset += concurrency) {
      const chunkIds = ids.slice(offset, offset + concurrency);
      const chunkTexts = texts.slice(offset, offset + concurrency);
      await Promise.all(
        chunkIds.map(async (id, index) => {
          const text = chunkTexts[index]!;
          let lastError: unknown;
          for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
            try {
              const embedding = await embedText(text);
              if (this.test) {
                await this.test.updateMemoryEmbedding(id, embedding);
              } else {
                await this.repo!.updateMemoryEmbedding(id, embedding);
              }
              return;
            } catch (err) {
              lastError = err;
            }
          }
          failures.push(`${id}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
        }),
      );
    }

    if (failures.length > 0) {
      throw new Error(`council vote memory embed failed (${failures.length}): ${failures[0]}`);
    }
  }

  private async append(input: {
    roomId: string;
    playerId: string;
    npcId: string;
    text: string;
    importance: number;
    embedding?: number[];
  }) {
    if (this.test) {
      await this.test.appendMemory(input);
      return;
    }
    await this.repo!.appendMemory(input);
  }

  async getMemoryCount(roomId: string, npcId: string, playerId: string): Promise<number> {
    if (this.test) return this.test.countRaw(roomId, playerId, npcId);
    return this.repo!.countRaw({ roomId, playerId, npcId, unsummarizedOnly: true });
  }

  async deleteForPlayer(roomId: string, playerId: string): Promise<void> {
    if (this.test) {
      await this.test.deleteForPlayer(roomId, playerId);
      return;
    }
    await this.repo!.deleteForPlayer({ roomId, playerId });
  }

  async deleteForPlayerNpc(
    roomId: string,
    playerId: string,
    npcId: string,
  ): Promise<void> {
    if (this.test) {
      await this.test.deleteForPlayer(roomId, playerId, npcId);
      return;
    }
    await this.repo!.deleteForPlayer({ roomId, playerId, npcId });
  }

  async buildMemoryContext(
    roomId: string,
    playerMessage: string,
    npcId: string,
    playerId: string,
    options?: { skipEmbed?: boolean; embedPriority?: boolean },
  ): Promise<MemoryContext> {
    if (playerId === COUNCIL_MEMORY_PLAYER_ID) {
      throw new Error("buildMemoryContext: __council__ scope is not valid for player speak");
    }
    return this.fetchMemoryContext(roomId, playerMessage, npcId, playerId, options);
  }

  /** Council-scoped RAG for vote/debate jobs (PERSONA-04); not for player speak. */
  async buildCouncilMemoryContext(
    roomId: string,
    npcId: string,
    query: string,
    options?: { skipEmbed?: boolean; embedPriority?: boolean },
  ): Promise<MemoryContext> {
    return this.fetchMemoryContext(roomId, query, npcId, COUNCIL_MEMORY_PLAYER_ID, options);
  }

  private async fetchCouncilRecentRetrieved(
    roomId: string,
    playerId: string,
    npcId: string,
    limit = 5,
  ): Promise<SimilarMemory[]> {
    if (this.test) {
      const recent = await this.test.recentBatch(roomId, playerId, npcId, limit);
      return councilRecentAsRetrieved(recent);
    }
    const recent = await this.repo!.getRecentUnsummarized({ roomId, playerId, npcId, limit });
    return councilRecentAsRetrieved(recent);
  }

  private async fetchMemoryContext(
    roomId: string,
    playerMessage: string,
    npcId: string,
    playerId: string,
    options?: { skipEmbed?: boolean; embedPriority?: boolean },
  ): Promise<MemoryContext> {
    const start = Date.now();
    const skipEmbed = options?.skipEmbed === true;
    const embedPriority = options?.embedPriority === true;
    const isCouncilScope = playerId === COUNCIL_MEMORY_PLAYER_ID;
    const collectivePromise = CollectiveService.getInstance().getCollectiveContext(
      roomId,
      npcId,
      playerId,
    );
    const recentCouncilPromise = isCouncilScope
      ? this.fetchCouncilRecentRetrieved(roomId, playerId, npcId)
      : Promise.resolve([] as SimilarMemory[]);

    if (this.test) {
      const collective = await collectivePromise;
      const recentCouncil = await recentCouncilPromise;
      if (skipEmbed) {
        return {
          memoryCount: await this.test.countRaw(roomId, playerId, npcId),
          retrieved: isCouncilScope ? recentCouncil : [],
          latestBulkSummary: this.test.latestSummary(roomId, playerId, npcId, "bulk"),
          latestReflection: this.test.latestSummary(roomId, playerId, npcId, "reflection"),
          timingMs: Date.now() - start,
          collective,
        };
      }
      const queryEmbedding = await embedText(playerMessage, { priority: embedPriority });
      const retrieved = await this.test.searchSimilar({
        roomId,
        playerId,
        npcId,
        queryEmbedding,
        k: 5,
      });
      return {
        memoryCount: await this.test.countRaw(roomId, playerId, npcId),
        retrieved: isCouncilScope ? mergeRetrievedMemories(retrieved, recentCouncil) : retrieved,
        latestBulkSummary: this.test.latestSummary(roomId, playerId, npcId, "bulk"),
        latestReflection: this.test.latestSummary(roomId, playerId, npcId, "reflection"),
        timingMs: Date.now() - start,
        collective,
      };
    }

    const repo = this.repo!;
    if (skipEmbed) {
      const [memoryCount, latestBulkSummary, latestReflection, collective, recentCouncil] =
        await Promise.all([
          repo.countRaw({ roomId, playerId, npcId, unsummarizedOnly: true }),
          repo.getLatestSummaryByKind({ roomId, playerId, npcId, kind: "bulk" }),
          repo.getLatestSummaryByKind({ roomId, playerId, npcId, kind: "reflection" }),
          collectivePromise,
          recentCouncilPromise,
        ]);
      return {
        memoryCount,
        retrieved: isCouncilScope ? recentCouncil : [],
        latestBulkSummary,
        latestReflection,
        timingMs: Date.now() - start,
        collective,
      };
    }

    const queryEmbedding = await embedText(playerMessage, { priority: embedPriority });
    const [retrieved, memoryCount, latestBulkSummary, latestReflection, collective, recentCouncil] =
      await Promise.all([
        repo.searchSimilar({ roomId, playerId, npcId, queryEmbedding, k: 5 }),
        repo.countRaw({ roomId, playerId, npcId, unsummarizedOnly: true }),
        repo.getLatestSummaryByKind({ roomId, playerId, npcId, kind: "bulk" }),
        repo.getLatestSummaryByKind({ roomId, playerId, npcId, kind: "reflection" }),
        collectivePromise,
        recentCouncilPromise,
      ]);

    return {
      memoryCount,
      retrieved: isCouncilScope ? mergeRetrievedMemories(retrieved, recentCouncil) : retrieved,
      latestBulkSummary,
      latestReflection,
      timingMs: Date.now() - start,
      collective,
    };
  }

  async storeReflection(
    roomId: string,
    text: string,
    npcId: string,
    playerId: string,
    semantic?: { mood?: string | null; beliefs?: string[] | null; summary?: string | null },
  ): Promise<void> {
    if (this.test) {
      await this.test.appendSummary({ roomId, playerId, npcId, kind: "reflection", text });
    } else {
      await this.repo!.appendSummary({ roomId, playerId, npcId, kind: "reflection", text });
    }
    if (semantic) {
      await this.upsertAttitudeSemantic(roomId, npcId, playerId, semantic);
    }
  }

  /**
   * Clamp then upsert attitude semantic columns (D-BELIEF-07/09/13).
   * Illegal/omitted fields are not written — prior values preserved.
   * Wired for reflect path in 29-06; no public HTTP surface (D-BELIEF-10).
   */
  async upsertAttitudeSemantic(
    roomId: string,
    npcId: string,
    playerId: string,
    input: { mood?: string | null; beliefs?: string[] | null; summary?: string | null },
  ): Promise<void> {
    const clamped = clampSemanticState(input);
    if (
      clamped.mood === undefined &&
      clamped.beliefs === undefined &&
      clamped.summary === undefined
    ) {
      return;
    }
    await CollectiveService.getInstance().repoRef().upsertSemanticState(roomId, npcId, playerId, {
      ...(clamped.mood !== undefined ? { mood: clamped.mood } : {}),
      ...(clamped.beliefs !== undefined ? { beliefs: clamped.beliefs } : {}),
      ...(clamped.summary !== undefined ? { summary: clamped.summary } : {}),
    });
  }

  async storeBulkSummary(
    roomId: string,
    text: string,
    sourceCount: number,
    markIds: string[],
    npcId: string,
    playerId: string,
  ): Promise<void> {
    if (this.test) {
      await this.test.appendSummary({
        roomId,
        playerId,
        npcId,
        kind: "bulk",
        text,
        sourceCount,
      });
      await this.test.markSummarized(markIds);
      return;
    }
    await this.repo!.appendSummary({ roomId, playerId, npcId, kind: "bulk", text, sourceCount });
    await this.repo!.markSummarized(markIds);
  }

  async getOldestUnsummarizedBatch(
    roomId: string,
    limit: number,
    npcId: string,
    playerId: string,
  ) {
    if (this.test) return this.test.oldestBatch(roomId, playerId, npcId, limit);
    return this.repo!.getOldestUnsummarizedBatch({ roomId, playerId, npcId, limit });
  }

  async getRecentUnsummarized(
    roomId: string,
    limit: number,
    npcId: string,
    playerId: string,
  ) {
    if (this.test) return this.test.recentBatch(roomId, playerId, npcId, limit);
    return this.repo!.getRecentUnsummarized({ roomId, playerId, npcId, limit });
  }

  async recordMutationAudit(input: {
    roomId: string;
    npcId: string;
    jobId?: string;
    actionType: string;
    actionPayload: string;
  }): Promise<void> {
    if (this.test) {
      await this.test.insertMutationAudit(input);
      return;
    }
    await this.repo!.insertMutationAudit({
      roomId: input.roomId,
      npcId: input.npcId,
      jobId: input.jobId,
      source: "executor",
      actionType: input.actionType,
      actionPayload: input.actionPayload,
    });
  }

  async listMutationAudits(roomId: string, limit = 50) {
    if (this.test) return this.test.listMutationAudits(roomId, limit);
    return this.repo!.listMutationAudits({ roomId, limit });
  }

  async getNpcMemoryDebug(
    roomId: string,
    npcId: string,
    playerId: string,
  ): Promise<NpcMemoryDebug> {
    if (this.test) {
      return {
        memoryCount: await this.test.countRaw(roomId, playerId, npcId),
        latestBulkSummary: this.test.latestSummary(roomId, playerId, npcId, "bulk"),
        latestReflection: this.test.latestSummary(roomId, playerId, npcId, "reflection"),
      };
    }

    const repo = this.repo!;
    const [memoryCount, latestBulkSummary, latestReflection] = await Promise.all([
      repo.countRaw({ roomId, playerId, npcId, unsummarizedOnly: true }),
      repo.getLatestSummaryByKind({ roomId, playerId, npcId, kind: "bulk" }),
      repo.getLatestSummaryByKind({ roomId, playerId, npcId, kind: "reflection" }),
    ]);

    return { memoryCount, latestBulkSummary, latestReflection };
  }
}
