import {
  COUNCIL_NPC_IDS,
  clampAffection,
  clampDeltaMagnitude,
  clampTrust,
  changeRateForArchetype,
  getPersona,
  normalizeEdgeIds,
  type LinkedEdge,
  type RelationshipDeltaInput,
  type RelationshipEdgePublic,
} from "@aetherlife/shared";
import { EMBED_DIMENSIONS, getSharedSql } from "@aetherlife/npc-memory";
import { randomUUID } from "node:crypto";
import { embedText } from "../memory/embed.js";

export type ListRelationshipsOptions = {
  npcId?: string;
  /** When npcId set, return top-N edges by abs(affection). Default 5. */
  limit?: number;
};

export type ApplyRelationshipDeltasInput = {
  roomId: string;
  deltas: RelationshipDeltaInput[];
  voteEpoch?: string;
  /** Game clock stamp for idle-decay idle windows (D-DECAY-03). */
  absoluteGameMinute?: number;
};

export type IdleDecayDelta = {
  npcAId: string;
  npcBId: string;
  affectionDelta: number;
};

export type ApplyIdleDecayDeltasInput = {
  roomId: string;
  deltas: IdleDecayDelta[];
};

export type ApplyRelationshipDeltasResult = {
  linkedEdges: LinkedEdge[];
};

type RelationshipRow = {
  id: string;
  roomId: string;
  npcAId: string;
  npcBId: string;
  baseTag: string;
  affection: number;
  trust: number;
  interactionCount: number;
  lastInteractAt: Date | null;
  currentStatus: string[];
  historySummary: string;
  embedding: number[] | null;
  updatedAt: Date;
};

type DbRow = {
  id: string;
  room_id: string;
  npc_a_id: string;
  npc_b_id: string;
  base_tag: string;
  affection: number;
  trust: number;
  interaction_count: number;
  last_interact_at: Date | string | null;
  current_status: unknown;
  history_summary: string;
  embedding?: number[] | string | null;
  updated_at: Date | string;
};

export type SimilarRelationshipEdge = {
  npcAId: string;
  npcBId: string;
  historySummary: string;
  currentStatus: string[];
  score: number;
};

export type SearchSimilarEdgesInput = {
  roomId: string;
  queryEmbedding: number[];
  activeNpcId?: string;
  k?: number;
};

/** D-EMBED-02: vector text = history + status; never affection ints / band id. */
export function buildRelationshipEmbedText(input: {
  historySummary: string;
  currentStatus: string[];
  /** Ignored — accepted so callers cannot accidentally concatenate via spread. */
  affection?: number;
  band?: string;
}): string {
  const history = (input.historySummary ?? "").trim();
  const status = (input.currentStatus ?? [])
    .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
    .map((t) => t.trim())
    .join(" ");
  return [history, status].filter((part) => part.length > 0).join("\n");
}

function parseEmbedding(raw: unknown): number[] | null {
  if (raw == null) return null;
  if (Array.isArray(raw)) {
    const nums = raw.filter((v): v is number => typeof v === "number");
    return nums.length === EMBED_DIMENSIONS ? nums : null;
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim().replace(/^\[/, "").replace(/\]$/, "");
    if (!trimmed) return null;
    const nums = trimmed.split(",").map((p) => Number(p.trim()));
    if (nums.length !== EMBED_DIMENSIONS || nums.some((n) => !Number.isFinite(n))) {
      return null;
    }
    return nums;
  }
  return null;
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom > 0 ? dot / denom : 0;
}

const memoryByRoom = new Map<string, RelationshipRow[]>();
/** Absolute game-minute of last real interact (not decay). Key: roomId:npcA:npcB */
const lastInteractAbsByEdge = new Map<string, number>();
/** Absolute game-minute when edge was seeded (for never-interacted idle). */
const seedAbsByEdge = new Map<string, number>();
let sqlClient: ReturnType<typeof getSharedSql> | null = null;

function edgeStampKey(roomId: string, npcAId: string, npcBId: string): string {
  const n = normalizeEdgeIds(npcAId, npcBId);
  return `${roomId}:${n.npcAId}:${n.npcBId}`;
}

export function getLastInteractAbsMinute(
  roomId: string,
  npcAId: string,
  npcBId: string,
): number | undefined {
  return lastInteractAbsByEdge.get(edgeStampKey(roomId, npcAId, npcBId));
}

export function getSeedAbsMinute(
  roomId: string,
  npcAId: string,
  npcBId: string,
): number | undefined {
  return seedAbsByEdge.get(edgeStampKey(roomId, npcAId, npcBId));
}

function noteSeedAbs(roomId: string, npcAId: string, npcBId: string, abs: number): void {
  const key = edgeStampKey(roomId, npcAId, npcBId);
  if (!seedAbsByEdge.has(key)) seedAbsByEdge.set(key, abs);
}

function noteInteractAbs(roomId: string, npcAId: string, npcBId: string, abs: number): void {
  lastInteractAbsByEdge.set(edgeStampKey(roomId, npcAId, npcBId), abs);
}

/**
 * After process restart, Maps are empty while SQL still has last_interact_at.
 * Stamp current abs so recently-interacted edges are not treated as idle (abs=0).
 * Returns how many edges were hydrated.
 */
export function hydrateInteractAbsFromEdges(
  roomId: string,
  absoluteGameMinute: number,
  edges: ReadonlyArray<{
    npcAId: string;
    npcBId: string;
    lastInteractAt: Date | null;
  }>,
): number {
  let hydrated = 0;
  for (const edge of edges) {
    if (!edge.lastInteractAt) continue;
    if (getLastInteractAbsMinute(roomId, edge.npcAId, edge.npcBId) !== undefined) {
      continue;
    }
    noteInteractAbs(roomId, edge.npcAId, edge.npcBId, absoluteGameMinute);
    hydrated += 1;
  }
  return hydrated;
}

/**
 * Restore seed stamps for never-interacted edges after restart (seed abs=0).
 * Without this, isIdleEdge falls back to 0 anyway — explicit stamp keeps parity with insert path.
 */
export function hydrateSeedAbsFromEdges(
  roomId: string,
  edges: ReadonlyArray<{
    npcAId: string;
    npcBId: string;
    lastInteractAt: Date | null;
  }>,
): number {
  let hydrated = 0;
  for (const edge of edges) {
    if (edge.lastInteractAt) continue;
    if (getSeedAbsMinute(roomId, edge.npcAId, edge.npcBId) !== undefined) continue;
    noteSeedAbs(roomId, edge.npcAId, edge.npcBId, 0);
    hydrated += 1;
  }
  return hydrated;
}

function getSql(): ReturnType<typeof getSharedSql> | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  if (!sqlClient) {
    sqlClient = getSharedSql(url);
  }
  return sqlClient;
}

function parseStatusTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function rowFromDb(raw: DbRow): RelationshipRow {
  return {
    id: raw.id,
    roomId: raw.room_id,
    npcAId: raw.npc_a_id,
    npcBId: raw.npc_b_id,
    baseTag: raw.base_tag,
    affection: raw.affection,
    trust: raw.trust,
    interactionCount: raw.interaction_count,
    lastInteractAt: raw.last_interact_at
      ? raw.last_interact_at instanceof Date
        ? raw.last_interact_at
        : new Date(raw.last_interact_at)
      : null,
    currentStatus: parseStatusTags(raw.current_status),
    historySummary: raw.history_summary,
    embedding: parseEmbedding(raw.embedding),
    updatedAt:
      raw.updated_at instanceof Date ? raw.updated_at : new Date(raw.updated_at),
  };
}

function toPublicEdge(row: RelationshipRow): RelationshipEdgePublic {
  return {
    npcAId: row.npcAId,
    npcBId: row.npcBId,
    baseTag: row.baseTag,
    affection: row.affection,
    trust: row.trust,
    interactionCount: row.interactionCount,
    lastInteractAt: row.lastInteractAt ? row.lastInteractAt.toISOString() : null,
    currentStatus: [...row.currentStatus],
    historySummary: row.historySummary,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function memoryRowsForRoom(roomId: string): RelationshipRow[] {
  return memoryByRoom.get(roomId) ?? [];
}

function findMemoryEdge(
  roomId: string,
  npcAId: string,
  npcBId: string,
): RelationshipRow | undefined {
  return memoryRowsForRoom(roomId).find(
    (row) => row.npcAId === npcAId && row.npcBId === npcBId,
  );
}

function scaledDeltaForEdge(
  delta: RelationshipDeltaInput,
  row: RelationshipRow,
): { affectionDelta: number; trustDelta: number } {
  const personaA = getPersona(delta.npcAId);
  const personaB = getPersona(delta.npcBId);
  const rate =
    (changeRateForArchetype(personaA.archetype) + changeRateForArchetype(personaB.archetype)) / 2;

  let affectionDelta = clampDeltaMagnitude(Math.round(delta.affectionDelta * rate));
  if (row.baseTag === "nemesis" && row.affection < -80 && affectionDelta > 0) {
    affectionDelta = Math.min(affectionDelta, 5);
  }

  const trustDelta =
    delta.trustDelta != null
      ? clampDeltaMagnitude(Math.round(delta.trustDelta * rate))
      : 0;

  return { affectionDelta, trustDelta };
}

function applyDeltaToRow(row: RelationshipRow, delta: RelationshipDeltaInput): boolean {
  const { affectionDelta, trustDelta } = scaledDeltaForEdge(delta, row);
  if (affectionDelta === 0 && trustDelta === 0 && !delta.historyAppend && !delta.statusTags?.length) {
    return false;
  }

  row.affection = clampAffection(row.affection + affectionDelta);
  if (trustDelta !== 0) {
    row.trust = clampTrust(row.trust + trustDelta);
  }
  row.interactionCount += 1;
  row.lastInteractAt = new Date();
  if (delta.statusTags?.length) {
    const merged = new Set([...row.currentStatus, ...delta.statusTags]);
    row.currentStatus = [...merged];
  }
  if (delta.historyAppend?.trim()) {
    const append = delta.historyAppend.trim();
    row.historySummary = row.historySummary
      ? `${row.historySummary} ${append}`
      : append;
  }
  row.updatedAt = new Date();
  return affectionDelta !== 0 || trustDelta !== 0 || Boolean(delta.historyAppend) || Boolean(delta.statusTags?.length);
}

export type InsertRelationshipEdgeInput = {
  roomId: string;
  npcAId: string;
  npcBId: string;
  baseTag: string;
  affection: number;
  trust: number;
  historySummary?: string;
};

async function insertMemoryEdge(input: InsertRelationshipEdgeInput): Promise<RelationshipRow> {
  const normalized = normalizeEdgeIds(input.npcAId, input.npcBId);
  const existing = findMemoryEdge(input.roomId, normalized.npcAId, normalized.npcBId);
  if (existing) return existing;

  const row: RelationshipRow = {
    id: randomUUID(),
    roomId: input.roomId,
    npcAId: normalized.npcAId,
    npcBId: normalized.npcBId,
    baseTag: input.baseTag,
    affection: clampAffection(input.affection),
    trust: clampTrust(input.trust),
    interactionCount: 0,
    lastInteractAt: null,
    currentStatus: [],
    historySummary: input.historySummary ?? "",
    embedding: null,
    updatedAt: new Date(),
  };
  const bucket = memoryByRoom.get(input.roomId) ?? [];
  bucket.push(row);
  memoryByRoom.set(input.roomId, bucket);
  noteSeedAbs(input.roomId, normalized.npcAId, normalized.npcBId, 0);
  return row;
}

async function insertSqlEdge(input: InsertRelationshipEdgeInput): Promise<RelationshipRow> {
  const sql = getSql();
  if (!sql) throw new Error("sql client unavailable");

  const normalized = normalizeEdgeIds(input.npcAId, input.npcBId);
  const rows = await sql<DbRow[]>`
    INSERT INTO npc_relationships (
      room_id,
      npc_a_id,
      npc_b_id,
      base_tag,
      affection,
      trust,
      history_summary
    )
    VALUES (
      ${input.roomId},
      ${normalized.npcAId},
      ${normalized.npcBId},
      ${input.baseTag},
      ${clampAffection(input.affection)},
      ${clampTrust(input.trust)},
      ${input.historySummary ?? ""}
    )
    ON CONFLICT (room_id, npc_a_id, npc_b_id) DO NOTHING
    RETURNING *
  `;

  if (rows.length > 0) {
    noteSeedAbs(input.roomId, normalized.npcAId, normalized.npcBId, 0);
    return rowFromDb(rows[0]!);
  }

  const existingRows = await sql<DbRow[]>`
    SELECT *
    FROM npc_relationships
    WHERE room_id = ${input.roomId}
      AND npc_a_id = ${normalized.npcAId}
      AND npc_b_id = ${normalized.npcBId}
    LIMIT 1
  `;
  if (existingRows.length > 0) {
    noteSeedAbs(input.roomId, normalized.npcAId, normalized.npcBId, 0);
    return rowFromDb(existingRows[0]!);
  }
  throw new Error("insertSqlEdge: conflict without existing row");
}

export async function insertRelationshipEdge(
  input: InsertRelationshipEdgeInput,
): Promise<RelationshipEdgePublic> {
  const sql = getSql();
  const row = sql ? await insertSqlEdge(input) : await insertMemoryEdge(input);
  return toPublicEdge(row);
}

function filterAndSortForNpc(
  rows: RelationshipRow[],
  npcId: string,
  limit: number,
): RelationshipRow[] {
  return rows
    .filter((row) => row.npcAId === npcId || row.npcBId === npcId)
    .sort((a, b) => Math.abs(b.affection) - Math.abs(a.affection))
    .slice(0, limit);
}

async function listMemory(
  roomId: string,
  options: ListRelationshipsOptions = {},
): Promise<RelationshipEdgePublic[]> {
  const rows = memoryRowsForRoom(roomId);
  if (options.npcId) {
    const limit = options.limit ?? 5;
    return filterAndSortForNpc(rows, options.npcId, limit).map(toPublicEdge);
  }
  return rows.map(toPublicEdge);
}

async function listSql(
  roomId: string,
  options: ListRelationshipsOptions = {},
): Promise<RelationshipEdgePublic[]> {
  const sql = getSql();
  if (!sql) throw new Error("sql client unavailable");

  if (options.npcId) {
    const limit = options.limit ?? 5;
    const npcId = options.npcId;
    const rows = await sql<DbRow[]>`
      SELECT *
      FROM npc_relationships
      WHERE room_id = ${roomId}
        AND (${npcId} = npc_a_id OR ${npcId} = npc_b_id)
      ORDER BY ABS(affection) DESC
      LIMIT ${limit}
    `;
    return rows.map((row) => toPublicEdge(rowFromDb(row)));
  }

  const rows = await sql<DbRow[]>`
    SELECT *
    FROM npc_relationships
    WHERE room_id = ${roomId}
    ORDER BY npc_a_id, npc_b_id
  `;
  return rows.map((row) => toPublicEdge(rowFromDb(row)));
}

export async function listRelationshipsForRoom(
  roomId: string,
  options: ListRelationshipsOptions = {},
): Promise<RelationshipEdgePublic[]> {
  const sql = getSql();
  return sql ? listSql(roomId, options) : listMemory(roomId, options);
}

export async function getRelationshipEdge(
  roomId: string,
  npcAId: string,
  npcBId: string,
): Promise<RelationshipEdgePublic | null> {
  const normalized = normalizeEdgeIds(npcAId, npcBId);
  const sql = getSql();
  if (sql) {
    const rows = await sql<DbRow[]>`
      SELECT *
      FROM npc_relationships
      WHERE room_id = ${roomId}
        AND npc_a_id = ${normalized.npcAId}
        AND npc_b_id = ${normalized.npcBId}
      LIMIT 1
    `;
    if (rows.length === 0) return null;
    return toPublicEdge(rowFromDb(rows[0]!));
  }

  const row = findMemoryEdge(roomId, normalized.npcAId, normalized.npcBId);
  return row ? toPublicEdge(row) : null;
}

export async function countRelationshipsForRoom(roomId: string): Promise<number> {
  const sql = getSql();
  if (sql) {
    const rows = await sql<{ count: string }[]>`
      SELECT COUNT(*)::text AS count
      FROM npc_relationships
      WHERE room_id = ${roomId}
    `;
    return Number(rows[0]?.count ?? 0);
  }
  return memoryRowsForRoom(roomId).length;
}

async function applyDeltasMemory(
  input: ApplyRelationshipDeltasInput,
): Promise<ApplyRelationshipDeltasResult> {
  const linkedEdges: LinkedEdge[] = [];
  const abs = input.absoluteGameMinute ?? 0;

  for (const delta of input.deltas) {
    const normalized = normalizeEdgeIds(delta.npcAId, delta.npcBId);
    const row = findMemoryEdge(input.roomId, normalized.npcAId, normalized.npcBId);
    if (!row) continue;

    const changed = applyDeltaToRow(row, {
      ...delta,
      npcAId: normalized.npcAId,
      npcBId: normalized.npcBId,
    });
    if (changed) {
      noteInteractAbs(input.roomId, normalized.npcAId, normalized.npcBId, abs);
      linkedEdges.push({ npcAId: normalized.npcAId, npcBId: normalized.npcBId });
    }
  }

  return { linkedEdges };
}

async function applyDeltasSql(
  input: ApplyRelationshipDeltasInput,
): Promise<ApplyRelationshipDeltasResult> {
  const linkedEdges: LinkedEdge[] = [];
  const abs = input.absoluteGameMinute ?? 0;

  for (const delta of input.deltas) {
    const normalized = normalizeEdgeIds(delta.npcAId, delta.npcBId);
    const sql = getSql();
    if (!sql) throw new Error("sql client unavailable");

    const rows = await sql<DbRow[]>`
      SELECT *
      FROM npc_relationships
      WHERE room_id = ${input.roomId}
        AND npc_a_id = ${normalized.npcAId}
        AND npc_b_id = ${normalized.npcBId}
      LIMIT 1
    `;
    if (rows.length === 0) continue;

    const row = rowFromDb(rows[0]!);
    const changed = applyDeltaToRow(row, {
      ...delta,
      npcAId: normalized.npcAId,
      npcBId: normalized.npcBId,
    });
    if (!changed) continue;

    noteInteractAbs(input.roomId, normalized.npcAId, normalized.npcBId, abs);

    await sql`
      UPDATE npc_relationships
      SET
        affection = ${row.affection},
        trust = ${row.trust},
        interaction_count = ${row.interactionCount},
        last_interact_at = ${row.lastInteractAt ? row.lastInteractAt.toISOString() : null},
        current_status = ${JSON.stringify(row.currentStatus)}::jsonb,
        history_summary = ${row.historySummary},
        updated_at = ${row.updatedAt.toISOString()}
      WHERE room_id = ${input.roomId}
        AND npc_a_id = ${normalized.npcAId}
        AND npc_b_id = ${normalized.npcBId}
    `;
    linkedEdges.push({ npcAId: normalized.npcAId, npcBId: normalized.npcBId });
  }

  return { linkedEdges };
}

export async function applyRelationshipDeltas(
  input: ApplyRelationshipDeltasInput,
): Promise<ApplyRelationshipDeltasResult> {
  const sql = getSql();
  const result = sql ? await applyDeltasSql(input) : await applyDeltasMemory(input);
  for (const edge of result.linkedEdges) {
    scheduleRelationshipEdgeEmbed(input.roomId, edge.npcAId, edge.npcBId);
  }
  return result;
}

/**
 * Fire-and-forget edge embed (D-EMBED-03). Never awaited from Colyseus hot path.
 * Force refresh after delta so history/status changes re-embed.
 */
export function scheduleRelationshipEdgeEmbed(
  roomId: string,
  npcAId: string,
  npcBId: string,
): void {
  void ensureRelationshipEdgeEmbedding(roomId, npcAId, npcBId, { force: true }).catch(
    (err) => {
      console.error(
        `[npc-relationships] async embed failed room=${roomId} ${npcAId}/${npcBId}`,
        err,
      );
    },
  );
}

/** Embed if missing or force refresh after delta (lazy speak miss + delta write). */
export async function ensureRelationshipEdgeEmbedding(
  roomId: string,
  npcAId: string,
  npcBId: string,
  options?: { force?: boolean },
): Promise<boolean> {
  const normalized = normalizeEdgeIds(npcAId, npcBId);
  const existing = await getRelationshipEdgeEmbedding(
    roomId,
    normalized.npcAId,
    normalized.npcBId,
  );
  if (existing && !options?.force) {
    return false;
  }

  const edge = await getRelationshipEdge(roomId, normalized.npcAId, normalized.npcBId);
  if (!edge) return false;

  const text = buildRelationshipEmbedText({
    historySummary: edge.historySummary,
    currentStatus: edge.currentStatus,
  });
  if (!text.trim()) return false;

  const embedding = await embedText(text);
  await updateEmbeddingForEdge(roomId, normalized.npcAId, normalized.npcBId, embedding);
  return true;
}

export async function updateEmbeddingForEdge(
  roomId: string,
  npcAId: string,
  npcBId: string,
  embedding: number[],
): Promise<void> {
  if (embedding.length !== EMBED_DIMENSIONS) {
    throw new Error(`unexpected embed dimensions: ${embedding.length}`);
  }
  const normalized = normalizeEdgeIds(npcAId, npcBId);
  const sql = getSql();
  if (sql) {
    const vectorLiteral = `[${embedding.join(",")}]`;
    await sql`
      UPDATE npc_relationships
      SET embedding = ${vectorLiteral}::vector
      WHERE room_id = ${roomId}
        AND npc_a_id = ${normalized.npcAId}
        AND npc_b_id = ${normalized.npcBId}
    `;
    return;
  }

  const row = findMemoryEdge(roomId, normalized.npcAId, normalized.npcBId);
  if (row) {
    row.embedding = [...embedding];
  }
}

export async function getRelationshipEdgeEmbedding(
  roomId: string,
  npcAId: string,
  npcBId: string,
): Promise<number[] | null> {
  const normalized = normalizeEdgeIds(npcAId, npcBId);
  const sql = getSql();
  if (sql) {
    const rows = await sql<{ embedding: unknown }[]>`
      SELECT embedding
      FROM npc_relationships
      WHERE room_id = ${roomId}
        AND npc_a_id = ${normalized.npcAId}
        AND npc_b_id = ${normalized.npcBId}
      LIMIT 1
    `;
    if (rows.length === 0) return null;
    return parseEmbedding(rows[0]!.embedding);
  }
  return findMemoryEdge(roomId, normalized.npcAId, normalized.npcBId)?.embedding ?? null;
}

export async function searchSimilarEdges(
  input: SearchSimilarEdgesInput,
): Promise<SimilarRelationshipEdge[]> {
  const k = input.k ?? 5;
  const sql = getSql();
  if (sql) {
    const vectorLiteral = `[${input.queryEmbedding.join(",")}]`;
    const active = input.activeNpcId;
    const rows = active
      ? await sql<
          {
            npc_a_id: string;
            npc_b_id: string;
            history_summary: string;
            current_status: unknown;
            score: number;
          }[]
        >`
          SELECT
            npc_a_id,
            npc_b_id,
            history_summary,
            current_status,
            (1 - (embedding <=> ${vectorLiteral}::vector)) AS score
          FROM npc_relationships
          WHERE room_id = ${input.roomId}
            AND embedding IS NOT NULL
            AND (${active} = npc_a_id OR ${active} = npc_b_id)
          ORDER BY embedding <=> ${vectorLiteral}::vector ASC
          LIMIT ${k}
        `
      : await sql<
          {
            npc_a_id: string;
            npc_b_id: string;
            history_summary: string;
            current_status: unknown;
            score: number;
          }[]
        >`
          SELECT
            npc_a_id,
            npc_b_id,
            history_summary,
            current_status,
            (1 - (embedding <=> ${vectorLiteral}::vector)) AS score
          FROM npc_relationships
          WHERE room_id = ${input.roomId}
            AND embedding IS NOT NULL
          ORDER BY embedding <=> ${vectorLiteral}::vector ASC
          LIMIT ${k}
        `;
    return rows.map((row) => ({
      npcAId: row.npc_a_id,
      npcBId: row.npc_b_id,
      historySummary: row.history_summary,
      currentStatus: parseStatusTags(row.current_status),
      score: Number(row.score),
    }));
  }

  const rows = memoryRowsForRoom(input.roomId).filter((row) => {
    if (!row.embedding || row.embedding.length !== EMBED_DIMENSIONS) return false;
    if (!input.activeNpcId) return true;
    return row.npcAId === input.activeNpcId || row.npcBId === input.activeNpcId;
  });

  return rows
    .map((row) => ({
      npcAId: row.npcAId,
      npcBId: row.npcBId,
      historySummary: row.historySummary,
      currentStatus: [...row.currentStatus],
      score: cosineSimilarity(row.embedding!, input.queryEmbedding),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

/**
 * Silent idle decay apply — updates affection only.
 * Does NOT bump last_interact_at, interaction_count, history, or status (pitfall #1).
 */
export async function applyIdleDecayDeltas(
  input: ApplyIdleDecayDeltasInput,
): Promise<{ updated: number }> {
  const sql = getSql();
  return sql ? applyIdleDecaySql(input) : applyIdleDecayMemory(input);
}

async function applyIdleDecayMemory(
  input: ApplyIdleDecayDeltasInput,
): Promise<{ updated: number }> {
  let updated = 0;
  for (const delta of input.deltas) {
    if (delta.affectionDelta === 0) continue;
    const normalized = normalizeEdgeIds(delta.npcAId, delta.npcBId);
    const row = findMemoryEdge(input.roomId, normalized.npcAId, normalized.npcBId);
    if (!row) continue;
    row.affection = clampAffection(row.affection + delta.affectionDelta);
    row.updatedAt = new Date();
    updated += 1;
  }
  return { updated };
}

async function applyIdleDecaySql(
  input: ApplyIdleDecayDeltasInput,
): Promise<{ updated: number }> {
  const sql = getSql();
  if (!sql) throw new Error("sql client unavailable");
  let updated = 0;

  for (const delta of input.deltas) {
    if (delta.affectionDelta === 0) continue;
    const normalized = normalizeEdgeIds(delta.npcAId, delta.npcBId);
    const rows = await sql<DbRow[]>`
      SELECT *
      FROM npc_relationships
      WHERE room_id = ${input.roomId}
        AND npc_a_id = ${normalized.npcAId}
        AND npc_b_id = ${normalized.npcBId}
      LIMIT 1
    `;
    if (rows.length === 0) continue;

    const row = rowFromDb(rows[0]!);
    const nextAffection = clampAffection(row.affection + delta.affectionDelta);
    const updatedAt = new Date();
    await sql`
      UPDATE npc_relationships
      SET
        affection = ${nextAffection},
        updated_at = ${updatedAt.toISOString()}
      WHERE room_id = ${input.roomId}
        AND npc_a_id = ${normalized.npcAId}
        AND npc_b_id = ${normalized.npcBId}
    `;
    updated += 1;
  }
  return { updated };
}

/** Test helper */
export function clearNpcRelationshipsMemory(): void {
  memoryByRoom.clear();
  lastInteractAbsByEdge.clear();
  seedAbsByEdge.clear();
}

/** Expected undirected edge count for 12 council seats. */
export function councilRelationshipPairCount(): number {
  const n = COUNCIL_NPC_IDS.length;
  return (n * (n - 1)) / 2;
}
