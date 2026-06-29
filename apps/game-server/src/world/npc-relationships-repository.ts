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
import { getSharedSql } from "@aetherlife/npc-memory";
import { randomUUID } from "node:crypto";

export type ListRelationshipsOptions = {
  npcId?: string;
  /** When npcId set, return top-N edges by abs(affection). Default 5. */
  limit?: number;
};

export type ApplyRelationshipDeltasInput = {
  roomId: string;
  deltas: RelationshipDeltaInput[];
  voteEpoch?: string;
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
  updated_at: Date | string;
};

const memoryByRoom = new Map<string, RelationshipRow[]>();
let sqlClient: ReturnType<typeof getSharedSql> | null = null;

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
    updatedAt: new Date(),
  };
  const bucket = memoryByRoom.get(input.roomId) ?? [];
  bucket.push(row);
  memoryByRoom.set(input.roomId, bucket);
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
      linkedEdges.push({ npcAId: normalized.npcAId, npcBId: normalized.npcBId });
    }
  }

  return { linkedEdges };
}

async function applyDeltasSql(
  input: ApplyRelationshipDeltasInput,
): Promise<ApplyRelationshipDeltasResult> {
  const linkedEdges: LinkedEdge[] = [];

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
  return sql ? applyDeltasSql(input) : applyDeltasMemory(input);
}

/** Test helper */
export function clearNpcRelationshipsMemory(): void {
  memoryByRoom.clear();
}

/** Expected undirected edge count for 12 council seats. */
export function councilRelationshipPairCount(): number {
  const n = COUNCIL_NPC_IDS.length;
  return (n * (n - 1)) / 2;
}
