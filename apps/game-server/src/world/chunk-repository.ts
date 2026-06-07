import type { ChunkDelta } from "@aetherlife/shared";
import { getSharedSql } from "@aetherlife/npc-memory";

type ChunkKey = string;

const memoryDeltas = new Map<ChunkKey, ChunkDelta>();

function key(worldId: string, cx: number, cy: number): ChunkKey {
  return `${worldId}:${cx},${cy}`;
}

let sqlClient: ReturnType<typeof getSharedSql> | null = null;

function getSql(): ReturnType<typeof getSharedSql> | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  if (!sqlClient) {
    sqlClient = getSharedSql(url);
  }
  return sqlClient;
}

export async function loadChunkDelta(
  worldId: string,
  cx: number,
  cy: number,
): Promise<ChunkDelta | null> {
  const sql = getSql();
  if (!sql) {
    return memoryDeltas.get(key(worldId, cx, cy)) ?? null;
  }
  const rows = await sql<
    { delta_json: ChunkDelta }[]
  >`SELECT delta_json FROM world_chunks WHERE world_id = ${worldId} AND cx = ${cx} AND cy = ${cy} LIMIT 1`;
  if (rows.length === 0) return null;
  return rows[0]!.delta_json ?? null;
}

export async function saveChunkDelta(
  worldId: string,
  cx: number,
  cy: number,
  delta: ChunkDelta,
): Promise<void> {
  const sql = getSql();
  if (!sql) {
    memoryDeltas.set(key(worldId, cx, cy), delta);
    return;
  }
  // String JSON — sql.json() breaks with postgres.js prepare:false (PgBouncer 6543).
  const deltaJson = JSON.stringify(delta);
  await sql`
    INSERT INTO world_chunks (world_id, cx, cy, delta_json, updated_at)
    VALUES (${worldId}, ${cx}, ${cy}, ${deltaJson}, now())
    ON CONFLICT (world_id, cx, cy)
    DO UPDATE SET delta_json = EXCLUDED.delta_json, updated_at = now()
  `;
}

/** Test helper — in-memory deltas only */
export function clearChunkDeltaMemory(): void {
  memoryDeltas.clear();
}

/** Test helper — in-memory + drop cached SQL client (unset DATABASE_URL in vitest) */
export function resetChunkRepositoryForTests(): void {
  memoryDeltas.clear();
  sqlClient = null;
}
