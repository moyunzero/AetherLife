import {
  NPC_PERSONAL_TIMELINE_TABLE,
  PERSONAL_TIMELINE_TAGS,
  computeProposalEligible,
  validatePersonalTimelineStrings,
  type PersonalTimelineCalendarLabel,
  type PersonalTimelineEntry,
  type PersonalTimelineSource,
  type PersonalTimelineTag,
} from "@aetherlife/shared";
import { getSharedSql } from "@aetherlife/npc-memory";
import { randomUUID } from "node:crypto";

export { computeProposalEligible };

export type InsertPersonalTimelineEntryInput = {
  roomId: string;
  npcId: string;
  calendarLabel: PersonalTimelineCalendarLabel | string;
  aetherEpochMinute: number;
  tag: PersonalTimelineTag;
  body: string;
  eventAnchorId?: string | null;
  factualSummary?: string | null;
  /** When omitted, computed via D-PROP-01. */
  proposalEligible?: boolean;
  source: PersonalTimelineSource;
};

export type ListPersonalTimelineParams = {
  roomId: string;
  npcId: string;
  limit?: number;
  offset?: number;
};

export type ListPersonalTimelineResult = {
  roomId: string;
  npcId: string;
  entries: PersonalTimelineEntry[];
};

type PersonalTimelineRow = {
  id: string;
  roomId: string;
  npcId: string;
  seq: number;
  calendarLabel: string;
  aetherEpochMinute: number;
  tag: PersonalTimelineTag;
  body: string;
  eventAnchorId: string | null;
  factualSummary: string | null;
  proposalEligible: boolean;
  source: PersonalTimelineSource;
  createdAt: Date;
};

type DbRow = {
  id: string;
  room_id: string;
  npc_id: string;
  seq: string | number;
  calendar_label: string;
  aether_epoch_minute: number;
  tag: PersonalTimelineTag;
  body: string;
  event_anchor_id: string | null;
  factual_summary: string | null;
  proposal_eligible: boolean;
  source: PersonalTimelineSource;
  created_at: Date | string;
};

const TAG_SET = new Set<string>(PERSONAL_TIMELINE_TAGS);
const SOURCE_SET = new Set<PersonalTimelineSource>([
  "seed",
  "llm_scheduled",
  "llm_event",
  "llm_reflection",
]);

/** Keyed by `${roomId}\0${npcId}` for per-npc seq. */
const memoryByNpc = new Map<string, PersonalTimelineRow[]>();

let sqlClient: ReturnType<typeof getSharedSql> | null = null;

function getSql(): ReturnType<typeof getSharedSql> | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  if (!sqlClient) {
    sqlClient = getSharedSql(url);
  }
  return sqlClient;
}

function memoryKey(roomId: string, npcId: string): string {
  return `${roomId}\0${npcId}`;
}

function assertTag(tag: string): PersonalTimelineTag {
  if (!TAG_SET.has(tag)) {
    throw new Error(`invalid personal timeline tag: ${tag}`);
  }
  return tag as PersonalTimelineTag;
}

function assertSource(source: string): PersonalTimelineSource {
  if (!SOURCE_SET.has(source as PersonalTimelineSource)) {
    throw new Error(`invalid personal timeline source: ${source}`);
  }
  return source as PersonalTimelineSource;
}

function toPublicEntry(row: PersonalTimelineRow): PersonalTimelineEntry {
  const entry: PersonalTimelineEntry = {
    id: row.id,
    roomId: row.roomId,
    npcId: row.npcId,
    seq: row.seq,
    calendarLabel: row.calendarLabel as PersonalTimelineCalendarLabel,
    aetherEpochMinute: row.aetherEpochMinute,
    tag: row.tag,
    body: row.body,
    proposalEligible: row.proposalEligible,
    source: row.source,
    createdAt:
      row.createdAt instanceof Date
        ? row.createdAt.toISOString()
        : new Date(row.createdAt).toISOString(),
  };
  if (row.eventAnchorId) entry.eventAnchorId = row.eventAnchorId;
  if (row.factualSummary) entry.factualSummary = row.factualSummary;
  return entry;
}

function rowFromDb(raw: DbRow): PersonalTimelineRow {
  return {
    id: raw.id,
    roomId: raw.room_id,
    npcId: raw.npc_id,
    seq: Number(raw.seq),
    calendarLabel: raw.calendar_label,
    aetherEpochMinute: raw.aether_epoch_minute,
    tag: raw.tag,
    body: raw.body,
    eventAnchorId: raw.event_anchor_id,
    factualSummary: raw.factual_summary,
    proposalEligible: Boolean(raw.proposal_eligible),
    source: raw.source,
    createdAt:
      raw.created_at instanceof Date ? raw.created_at : new Date(raw.created_at),
  };
}

function memoryRowsForNpc(roomId: string, npcId: string): PersonalTimelineRow[] {
  return memoryByNpc.get(memoryKey(roomId, npcId)) ?? [];
}

function nextMemorySeq(roomId: string, npcId: string): number {
  const rows = memoryRowsForNpc(roomId, npcId);
  if (rows.length === 0) return 1;
  return Math.max(...rows.map((r) => r.seq)) + 1;
}

async function insertMemoryRow(
  input: InsertPersonalTimelineEntryInput,
  proposalEligible: boolean,
): Promise<PersonalTimelineRow> {
  const row: PersonalTimelineRow = {
    id: randomUUID(),
    roomId: input.roomId,
    npcId: input.npcId,
    seq: nextMemorySeq(input.roomId, input.npcId),
    calendarLabel: String(input.calendarLabel),
    aetherEpochMinute: input.aetherEpochMinute,
    tag: input.tag,
    body: input.body,
    eventAnchorId: input.eventAnchorId ?? null,
    factualSummary: input.factualSummary ?? null,
    proposalEligible,
    source: input.source,
    createdAt: new Date(),
  };
  const key = memoryKey(input.roomId, input.npcId);
  const existing = memoryByNpc.get(key) ?? [];
  existing.push(row);
  memoryByNpc.set(key, existing);
  return row;
}

async function insertSqlRow(
  input: InsertPersonalTimelineEntryInput,
  proposalEligible: boolean,
): Promise<PersonalTimelineRow> {
  const sql = getSql();
  if (!sql) throw new Error("sql client unavailable");

  const rows = await sql.begin(async (tx) => {
    // Per-(room,npc) advisory lock for seq allocation
    await tx`SELECT pg_advisory_xact_lock(hashtext(${input.roomId}), hashtext(${input.npcId}))`;
    const maxRows = await tx<{ max_seq: string | null }[]>`
      SELECT MAX(seq) AS max_seq
      FROM npc_personal_timeline
      WHERE room_id = ${input.roomId}
        AND npc_id = ${input.npcId}
    `;
    const nextSeq = Number(maxRows[0]?.max_seq ?? 0) + 1;

    return tx<DbRow[]>`
      INSERT INTO npc_personal_timeline (
        room_id,
        npc_id,
        seq,
        calendar_label,
        aether_epoch_minute,
        tag,
        body,
        event_anchor_id,
        factual_summary,
        proposal_eligible,
        source
      )
      VALUES (
        ${input.roomId},
        ${input.npcId},
        ${nextSeq},
        ${String(input.calendarLabel)},
        ${input.aetherEpochMinute},
        ${input.tag},
        ${input.body},
        ${input.eventAnchorId ?? null},
        ${input.factualSummary ?? null},
        ${proposalEligible},
        ${input.source}
      )
      RETURNING *
    `;
  });

  return rowFromDb(rows[0]!);
}

export async function insertPersonalTimelineEntry(
  input: InsertPersonalTimelineEntryInput,
): Promise<PersonalTimelineEntry> {
  assertTag(input.tag);
  assertSource(input.source);

  const blocked = validatePersonalTimelineStrings({
    body: input.body,
    factualSummary: input.factualSummary,
  });
  if (blocked) {
    throw new Error(`personal timeline content blocked: ${blocked}`);
  }

  const proposalEligible =
    input.proposalEligible ??
    computeProposalEligible({
      tag: input.tag,
      eventAnchorId: input.eventAnchorId,
      source: input.source,
    });

  const sql = getSql();
  const row = sql
    ? await insertSqlRow(input, proposalEligible)
    : await insertMemoryRow(input, proposalEligible);
  return toPublicEntry(row);
}

async function updateMemoryBody(
  roomId: string,
  entryId: string,
  body: string,
): Promise<PersonalTimelineRow | null> {
  for (const rows of memoryByNpc.values()) {
    const row = rows.find((r) => r.id === entryId && r.roomId === roomId);
    if (row) {
      row.body = body;
      return row;
    }
  }
  return null;
}

async function updateSqlBody(
  roomId: string,
  entryId: string,
  body: string,
): Promise<PersonalTimelineRow | null> {
  const sql = getSql();
  if (!sql) throw new Error("sql client unavailable");

  const rows = await sql<DbRow[]>`
    UPDATE npc_personal_timeline
    SET body = ${body}
    WHERE room_id = ${roomId} AND id = ${entryId}::uuid
    RETURNING *
  `;
  if (!rows[0]) return null;
  return rowFromDb(rows[0]);
}

/** D-SEED-04: replace skeleton body in place when polish succeeds. */
export async function updatePersonalTimelineBody(input: {
  roomId: string;
  entryId: string;
  body: string;
}): Promise<PersonalTimelineEntry | null> {
  const blocked = validatePersonalTimelineStrings({ body: input.body });
  if (blocked) {
    throw new Error(`personal timeline content blocked: ${blocked}`);
  }

  const sql = getSql();
  const row = sql
    ? await updateSqlBody(input.roomId, input.entryId, input.body)
    : await updateMemoryBody(input.roomId, input.entryId, input.body);
  return row ? toPublicEntry(row) : null;
}

async function updateMemoryCalendarStamp(
  roomId: string,
  entryId: string,
  calendarLabel: string,
  aetherEpochMinute: number,
): Promise<PersonalTimelineRow | null> {
  for (const rows of memoryByNpc.values()) {
    const row = rows.find((r) => r.id === entryId && r.roomId === roomId);
    if (row) {
      row.calendarLabel = calendarLabel;
      row.aetherEpochMinute = aetherEpochMinute;
      return row;
    }
  }
  return null;
}

async function updateSqlCalendarStamp(
  roomId: string,
  entryId: string,
  calendarLabel: string,
  aetherEpochMinute: number,
): Promise<PersonalTimelineRow | null> {
  const sql = getSql();
  if (!sql) throw new Error("sql client unavailable");

  const rows = await sql<DbRow[]>`
    UPDATE npc_personal_timeline
    SET calendar_label = ${calendarLabel},
        aether_epoch_minute = ${aetherEpochMinute}
    WHERE room_id = ${roomId} AND id = ${entryId}::uuid
    RETURNING *
  `;
  if (!rows[0]) return null;
  return rowFromDb(rows[0]);
}

/** Repair pre-arrival seed stamps (太乙 → 生平·{age}). */
export async function updatePersonalTimelineCalendarStamp(input: {
  roomId: string;
  entryId: string;
  calendarLabel: PersonalTimelineCalendarLabel | string;
  aetherEpochMinute: number;
}): Promise<PersonalTimelineEntry | null> {
  const sql = getSql();
  const row = sql
    ? await updateSqlCalendarStamp(
        input.roomId,
        input.entryId,
        String(input.calendarLabel),
        input.aetherEpochMinute,
      )
    : await updateMemoryCalendarStamp(
        input.roomId,
        input.entryId,
        String(input.calendarLabel),
        input.aetherEpochMinute,
      );
  return row ? toPublicEntry(row) : null;
}

function clampLimit(raw?: number): number {
  const n = raw ?? 50;
  if (!Number.isFinite(n)) return 50;
  return Math.min(200, Math.max(1, Math.trunc(n)));
}

function normalizeOffset(raw?: number): number {
  const n = raw ?? 0;
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.trunc(n);
}

async function listMemory(
  params: ListPersonalTimelineParams,
): Promise<ListPersonalTimelineResult> {
  const limit = clampLimit(params.limit);
  const offset = normalizeOffset(params.offset);
  const rows = memoryRowsForNpc(params.roomId, params.npcId)
    .slice()
    .sort((a, b) => b.seq - a.seq)
    .slice(offset, offset + limit);

  return {
    roomId: params.roomId,
    npcId: params.npcId,
    entries: rows.map(toPublicEntry),
  };
}

async function listSql(
  params: ListPersonalTimelineParams,
): Promise<ListPersonalTimelineResult> {
  const sql = getSql();
  if (!sql) throw new Error("sql client unavailable");

  const limit = clampLimit(params.limit);
  const offset = normalizeOffset(params.offset);

  const rows = await sql<DbRow[]>`
    SELECT *
    FROM npc_personal_timeline
    WHERE room_id = ${params.roomId}
      AND npc_id = ${params.npcId}
    ORDER BY seq DESC
    LIMIT ${limit}
    OFFSET ${offset}
  `;

  return {
    roomId: params.roomId,
    npcId: params.npcId,
    entries: rows.map((r) => toPublicEntry(rowFromDb(r))),
  };
}

export async function listPersonalTimelineForNpc(
  params: ListPersonalTimelineParams,
): Promise<ListPersonalTimelineResult> {
  const sql = getSql();
  return sql ? listSql(params) : listMemory(params);
}

/** Test helper — clears in-memory fallback store. */
export function clearPersonalTimelineMemory(): void {
  memoryByNpc.clear();
}

/** Compile-time / docs: table name constant used by isolation tests. */
export const PERSONAL_TIMELINE_TABLE = NPC_PERSONAL_TIMELINE_TABLE;
