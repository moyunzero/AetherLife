import {
  createDb,
  MemoryRepository,
  type SimilarMemory,
  type SummaryKind,
} from "@aetherlife/npc-memory";
import { embedText } from "./embed.js";
import { scoreImportance } from "./importance.js";

export type MemoryContext = {
  memoryCount: number;
  retrieved: SimilarMemory[];
  latestBulkSummary: string | null;
  latestReflection: string | null;
  timingMs: number;
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
      createdAt: new Date(),
    });
    return id;
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
        const score = sim * (0.5 + m.importance / 20);
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

  async appendPlayerMemory(
    roomId: string,
    text: string,
    npcId: string,
    playerId: string,
  ): Promise<void> {
    const line = text.startsWith("player:") ? text : `player: ${text}`;
    const importance = await scoreImportance(line);
    const embedding = await embedText(line);
    await this.append({ roomId, playerId, npcId, text: line, importance, embedding });
  }

  async appendNpcMemory(
    roomId: string,
    text: string,
    npcId: string,
    playerId: string,
    importance?: number,
  ): Promise<void> {
    const line = text.startsWith("npc:") ? text : `npc: ${text}`;
    const score = importance ?? (await scoreImportance(line));
    const embedding = await embedText(line);
    await this.append({ roomId, playerId, npcId, text: line, importance: score, embedding });
  }

  private async append(input: {
    roomId: string;
    playerId: string;
    npcId: string;
    text: string;
    importance: number;
    embedding: number[];
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
  ): Promise<MemoryContext> {
    const start = Date.now();
    const queryEmbedding = await embedText(playerMessage);

    if (this.test) {
      const retrieved = await this.test.searchSimilar({
        roomId,
        playerId,
        npcId,
        queryEmbedding,
        k: 5,
      });
      return {
        memoryCount: await this.test.countRaw(roomId, playerId, npcId),
        retrieved,
        latestBulkSummary: this.test.latestSummary(roomId, playerId, npcId, "bulk"),
        latestReflection: this.test.latestSummary(roomId, playerId, npcId, "reflection"),
        timingMs: Date.now() - start,
      };
    }

    const repo = this.repo!;
    const [retrieved, memoryCount, latestBulkSummary, latestReflection] = await Promise.all([
      repo.searchSimilar({ roomId, playerId, npcId, queryEmbedding, k: 5 }),
      repo.countRaw({ roomId, playerId, npcId, unsummarizedOnly: true }),
      repo.getLatestSummaryByKind({ roomId, playerId, npcId, kind: "bulk" }),
      repo.getLatestSummaryByKind({ roomId, playerId, npcId, kind: "reflection" }),
    ]);

    return {
      memoryCount,
      retrieved,
      latestBulkSummary,
      latestReflection,
      timingMs: Date.now() - start,
    };
  }

  async storeReflection(
    roomId: string,
    text: string,
    npcId: string,
    playerId: string,
  ): Promise<void> {
    if (this.test) {
      await this.test.appendSummary({ roomId, playerId, npcId, kind: "reflection", text });
      return;
    }
    await this.repo!.appendSummary({ roomId, playerId, npcId, kind: "reflection", text });
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
