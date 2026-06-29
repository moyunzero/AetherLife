import {
  formatChronicleYearLabel,
  parseWorldHistoryMinutes,
  toWorldHistoryListEntry,
  validateWorldHistoryStrings,
  type WorldHistoryEntryKind,
  type WorldHistoryListEntry,
  type WorldHistoryMinutes,
  type WorldHistoryPublicEntry,
  type WorldHistoryStatus,
  type WorldHistoryStatusFilter,
} from "@aetherlife/shared";
import { getSharedSql } from "@aetherlife/npc-memory";
import { randomUUID } from "node:crypto";

const PROPOSAL_EXCERPT_MAX = 120;
const DEFAULT_PAGE_SIZE = 6;
const MIN_PAGE_SIZE = 5;
const MAX_PAGE_SIZE = 8;

export type InsertWorldHistoryEntryInput = {
  roomId: string;
  entryKind: WorldHistoryEntryKind;
  status: WorldHistoryStatus;
  title: string;
  proposal: string;
  proposerNpcId?: string | null;
  proposerDisplayName: string;
  yesCount?: number | null;
  noCount?: number | null;
  minutes: WorldHistoryMinutes;
  gameYear: number;
  gameMinuteSnapshot: number;
  voteEpoch?: string | null;
};

export type ListWorldHistoryParams = {
  roomId: string;
  gameYear?: number;
  page?: number;
  pageSize?: number;
  status?: WorldHistoryStatusFilter;
};

export type ListWorldHistoryResult = {
  gameYear: number;
  gameYearLabel: string;
  page: number;
  pageSize: number;
  totalInYear: number;
  totalPages: number;
  availableYears: number[];
  entries: WorldHistoryListEntry[];
};

type WorldHistoryRow = {
  id: string;
  roomId: string;
  sequence: number;
  entryKind: WorldHistoryEntryKind;
  status: WorldHistoryStatus;
  title: string;
  proposal: string;
  proposerNpcId: string | null;
  proposerDisplayName: string;
  yesCount: number | null;
  noCount: number | null;
  minutesJson: WorldHistoryMinutes;
  gameYear: number;
  gameMinuteSnapshot: number;
  voteEpoch: string | null;
  createdAt: Date;
};

type DbRow = {
  id: string;
  room_id: string;
  sequence: string | number;
  entry_kind: WorldHistoryEntryKind;
  status: WorldHistoryStatus;
  title: string;
  proposal: string;
  proposer_npc_id: string | null;
  proposer_display_name: string;
  yes_count: number | null;
  no_count: number | null;
  minutes_json: unknown;
  game_year: number;
  game_minute_snapshot: number;
  vote_epoch: string | null;
  created_at: Date | string;
};

type DbListRow = {
  id: string;
  room_id: string;
  sequence: string | number;
  entry_kind: WorldHistoryEntryKind;
  status: WorldHistoryStatus;
  title: string;
  proposal: string;
  proposer_display_name: string;
  yes_count: number | null;
  no_count: number | null;
  game_year: number;
  created_at: Date | string;
};

const memoryByRoom = new Map<string, WorldHistoryRow[]>();

let sqlClient: ReturnType<typeof getSharedSql> | null = null;

function getSql(): ReturnType<typeof getSharedSql> | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  if (!sqlClient) {
    sqlClient = getSharedSql(url);
  }
  return sqlClient;
}

function clampPageSize(raw?: number): number {
  const n = raw ?? DEFAULT_PAGE_SIZE;
  if (!Number.isFinite(n)) return DEFAULT_PAGE_SIZE;
  return Math.min(MAX_PAGE_SIZE, Math.max(MIN_PAGE_SIZE, Math.trunc(n)));
}

function normalizePage(raw?: number): number {
  const n = raw ?? 1;
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.trunc(n);
}

function proposalExcerpt(proposal: string): string {
  const trimmed = proposal.trim();
  if (trimmed.length <= PROPOSAL_EXCERPT_MAX) return trimmed;
  return `${trimmed.slice(0, PROPOSAL_EXCERPT_MAX)}…`;
}

function tallyLabel(
  entryKind: WorldHistoryEntryKind,
  yesCount: number | null,
  noCount: number | null,
): string | null {
  if (entryKind === "genesis") return null;
  if (yesCount == null || noCount == null) return null;
  return `${yesCount}–${noCount}`;
}

function toPublicEntry(row: WorldHistoryRow): WorldHistoryPublicEntry {
  return {
    id: row.id,
    sequence: row.sequence,
    entryKind: row.entryKind,
    status: row.status,
    title: row.title,
    proposalExcerpt: proposalExcerpt(row.proposal),
    proposerDisplayName: row.proposerDisplayName,
    gameYear: row.gameYear,
    gameYearLabel: formatChronicleYearLabel(row.gameYear),
    yesCount: row.yesCount,
    noCount: row.noCount,
    tallyLabel: tallyLabel(row.entryKind, row.yesCount, row.noCount),
    createdAt:
      row.createdAt instanceof Date
        ? row.createdAt.toISOString()
        : new Date(row.createdAt).toISOString(),
    minutes: row.minutesJson,
  };
}

function toPublicListEntry(row: WorldHistoryRow): WorldHistoryListEntry {
  return toWorldHistoryListEntry(toPublicEntry(row));
}

function listEntryFromDb(raw: DbListRow): WorldHistoryListEntry {
  const entryKind = raw.entry_kind;
  const yesCount = raw.yes_count;
  const noCount = raw.no_count;
  return {
    id: raw.id,
    sequence: Number(raw.sequence),
    entryKind,
    status: raw.status,
    title: raw.title,
    proposalExcerpt: proposalExcerpt(raw.proposal),
    proposerDisplayName: raw.proposer_display_name,
    gameYear: raw.game_year,
    gameYearLabel: formatChronicleYearLabel(raw.game_year),
    yesCount,
    noCount,
    tallyLabel: tallyLabel(entryKind, yesCount, noCount),
    createdAt:
      raw.created_at instanceof Date
        ? raw.created_at.toISOString()
        : new Date(raw.created_at).toISOString(),
  };
}

function rowFromDb(raw: DbRow): WorldHistoryRow {
  return {
    id: raw.id,
    roomId: raw.room_id,
    sequence: Number(raw.sequence),
    entryKind: raw.entry_kind,
    status: raw.status,
    title: raw.title,
    proposal: raw.proposal,
    proposerNpcId: raw.proposer_npc_id,
    proposerDisplayName: raw.proposer_display_name,
    yesCount: raw.yes_count,
    noCount: raw.no_count,
    minutesJson: parseWorldHistoryMinutes(raw.minutes_json, { proposerNpcId: raw.proposer_npc_id }),
    gameYear: raw.game_year,
    gameMinuteSnapshot: raw.game_minute_snapshot,
    voteEpoch: raw.vote_epoch,
    createdAt:
      raw.created_at instanceof Date ? raw.created_at : new Date(raw.created_at),
  };
}

function memoryRowsForRoom(roomId: string): WorldHistoryRow[] {
  return memoryByRoom.get(roomId) ?? [];
}

function nextMemorySequence(roomId: string): number {
  const rows = memoryRowsForRoom(roomId);
  if (rows.length === 0) return 1;
  return Math.max(...rows.map((r) => r.sequence)) + 1;
}

async function insertMemoryRow(input: InsertWorldHistoryEntryInput): Promise<WorldHistoryRow> {
  const minutes = parseWorldHistoryMinutes(input.minutes);
  const row: WorldHistoryRow = {
    id: randomUUID(),
    roomId: input.roomId,
    sequence: nextMemorySequence(input.roomId),
    entryKind: input.entryKind,
    status: input.status,
    title: input.title,
    proposal: input.proposal,
    proposerNpcId: input.proposerNpcId ?? null,
    proposerDisplayName: input.proposerDisplayName,
    yesCount: input.yesCount ?? null,
    noCount: input.noCount ?? null,
    minutesJson: minutes,
    gameYear: input.gameYear,
    gameMinuteSnapshot: input.gameMinuteSnapshot,
    voteEpoch: input.voteEpoch ?? null,
    createdAt: new Date(),
  };
  const existing = memoryByRoom.get(input.roomId) ?? [];
  existing.push(row);
  memoryByRoom.set(input.roomId, existing);
  return row;
}

async function insertSqlRow(input: InsertWorldHistoryEntryInput): Promise<WorldHistoryRow> {
  const sql = getSql();
  if (!sql) throw new Error("sql client unavailable");

  const minutes = parseWorldHistoryMinutes(input.minutes);
  const minutesJson = JSON.stringify(minutes);

  const rows = await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${input.roomId}))`;
    const maxRows = await tx<{ max_seq: string | null }[]>`
      SELECT MAX(sequence) AS max_seq
      FROM world_history
      WHERE room_id = ${input.roomId}
    `;
    const nextSeq = Number(maxRows[0]?.max_seq ?? 0) + 1;

    return tx<DbRow[]>`
      INSERT INTO world_history (
        room_id,
        sequence,
        entry_kind,
        status,
        title,
        proposal,
        proposer_npc_id,
        proposer_display_name,
        yes_count,
        no_count,
        minutes_json,
        game_year,
        game_minute_snapshot,
        vote_epoch
      )
      VALUES (
        ${input.roomId},
        ${nextSeq},
        ${input.entryKind},
        ${input.status},
        ${input.title},
        ${input.proposal},
        ${input.proposerNpcId ?? null},
        ${input.proposerDisplayName},
        ${input.yesCount ?? null},
        ${input.noCount ?? null},
        ${minutesJson}::jsonb,
        ${input.gameYear},
        ${input.gameMinuteSnapshot},
        ${input.voteEpoch ?? null}
      )
      RETURNING *
    `;
  });

  return rowFromDb(rows[0]!);
}

export async function insertWorldHistoryEntry(
  input: InsertWorldHistoryEntryInput,
): Promise<WorldHistoryPublicEntry> {
  const blocked = validateWorldHistoryStrings({
    title: input.title,
    proposal: input.proposal,
  });
  if (blocked) {
    throw new Error(`world history content blocked: ${blocked}`);
  }

  parseWorldHistoryMinutes(input.minutes);

  const sql = getSql();
  const row = sql ? await insertSqlRow(input) : await insertMemoryRow(input);
  return toPublicEntry(row);
}

function filterRowsByStatus(
  rows: WorldHistoryRow[],
  status: WorldHistoryStatusFilter,
): WorldHistoryRow[] {
  if (status === "all") return rows;
  return rows.filter((row) => row.status === status);
}

function availableYearsFromRows(rows: WorldHistoryRow[]): number[] {
  const years = new Set(rows.map((row) => row.gameYear));
  return [...years].sort((a, b) => b - a);
}

async function listMemory(params: ListWorldHistoryParams): Promise<ListWorldHistoryResult> {
  const pageSize = clampPageSize(params.pageSize);
  const page = normalizePage(params.page);
  const status = params.status ?? "accepted";

  const allRows = memoryRowsForRoom(params.roomId);
  const years = availableYearsFromRows(allRows);
  const gameYear = params.gameYear ?? years[0] ?? 1;

  const yearRows = filterRowsByStatus(
    allRows.filter((row) => row.gameYear === gameYear),
    status,
  ).sort((a, b) => b.sequence - a.sequence);

  const totalInYear = yearRows.length;
  const totalPages = totalInYear === 0 ? 0 : Math.ceil(totalInYear / pageSize);
  const offset = (page - 1) * pageSize;
  const pageRows = yearRows.slice(offset, offset + pageSize);

  return {
    gameYear,
    gameYearLabel: formatChronicleYearLabel(gameYear),
    page,
    pageSize,
    totalInYear,
    totalPages,
    availableYears: years.length > 0 ? years : [1],
    entries: pageRows.map(toPublicListEntry),
  };
}

async function listSql(params: ListWorldHistoryParams): Promise<ListWorldHistoryResult> {
  const sql = getSql();
  if (!sql) throw new Error("sql client unavailable");

  const pageSize = clampPageSize(params.pageSize);
  const page = normalizePage(params.page);
  const status = params.status ?? "accepted";

  const yearRows = await sql<{ game_year: number }[]>`
    SELECT DISTINCT game_year
    FROM world_history
    WHERE room_id = ${params.roomId}
    ORDER BY game_year DESC
  `;
  const availableYears =
    yearRows.length > 0 ? yearRows.map((r) => r.game_year) : [1];
  const gameYear = params.gameYear ?? availableYears[0] ?? 1;
  const offset = (page - 1) * pageSize;

  const [countRows, rows] = await Promise.all([
    sql<{ count: string }[]>`
      SELECT COUNT(*)::text AS count
      FROM world_history
      WHERE room_id = ${params.roomId}
        AND game_year = ${gameYear}
        AND (${status} = 'all' OR status = ${status})
    `,
    sql<DbListRow[]>`
      SELECT
        id,
        room_id,
        sequence,
        entry_kind,
        status,
        title,
        proposal,
        proposer_display_name,
        yes_count,
        no_count,
        game_year,
        created_at
      FROM world_history
      WHERE room_id = ${params.roomId}
        AND game_year = ${gameYear}
        AND (${status} = 'all' OR status = ${status})
      ORDER BY sequence DESC
      LIMIT ${pageSize}
      OFFSET ${offset}
    `,
  ]);
  const totalInYear = Number(countRows[0]?.count ?? 0);
  const totalPages = totalInYear === 0 ? 0 : Math.ceil(totalInYear / pageSize);

  return {
    gameYear,
    gameYearLabel: formatChronicleYearLabel(gameYear),
    page,
    pageSize,
    totalInYear,
    totalPages,
    availableYears,
    entries: rows.map(listEntryFromDb),
  };
}

export async function listWorldHistory(
  params: ListWorldHistoryParams,
): Promise<ListWorldHistoryResult> {
  const sql = getSql();
  return sql ? listSql(params) : listMemory(params);
}

export async function getWorldHistoryEntry(
  roomId: string,
  entryId: string,
): Promise<WorldHistoryPublicEntry | null> {
  const sql = getSql();
  if (sql) {
    const rows = await sql<DbRow[]>`
      SELECT *
      FROM world_history
      WHERE room_id = ${roomId}
        AND id = ${entryId}
      LIMIT 1
    `;
    if (rows.length === 0) return null;
    return toPublicEntry(rowFromDb(rows[0]!));
  }

  const row = memoryRowsForRoom(roomId).find((r) => r.id === entryId);
  return row ? toPublicEntry(row) : null;
}

export async function countGenesisEntries(roomId: string): Promise<number> {
  const sql = getSql();
  if (!sql) {
    return memoryRowsForRoom(roomId).filter((row) => row.entryKind === "genesis").length;
  }
  const rows = await sql<{ count: string }[]>`
    SELECT COUNT(*)::text AS count
    FROM world_history
    WHERE room_id = ${roomId}
      AND entry_kind = 'genesis'
  `;
  return Number(rows[0]?.count ?? 0);
}

/** Test helper */
export function clearWorldHistoryMemory(): void {
  memoryByRoom.clear();
}
