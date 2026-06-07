import {
  parseChunkLore,
  validateChunkLoreStrings,
  type ChunkLore,
} from "@aetherlife/shared";
import { getSharedSql } from "@aetherlife/npc-memory";

type LoreKey = string;

const memoryLore = new Map<LoreKey, { lore: ChunkLore; modelTier: string }>();

function key(worldId: string, cx: number, cy: number): LoreKey {
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

export type ChunkLoreRow = {
  lore: ChunkLore;
  modelTier: string;
};

export async function getChunkLore(
  worldId: string,
  cx: number,
  cy: number,
): Promise<ChunkLoreRow | null> {
  const sql = getSql();
  if (!sql) {
    const row = memoryLore.get(key(worldId, cx, cy));
    return row ?? null;
  }
  const rows = await sql<
    { lore_json: ChunkLore; model_tier: string }[]
  >`SELECT lore_json, model_tier FROM world_chunk_lore WHERE world_id = ${worldId} AND cx = ${cx} AND cy = ${cy} LIMIT 1`;
  if (rows.length === 0) return null;
  const lore = parseChunkLore(rows[0]!.lore_json);
  return { lore, modelTier: rows[0]!.model_tier };
}

export async function upsertChunkLore(
  worldId: string,
  cx: number,
  cy: number,
  lore: unknown,
  modelTier: string,
): Promise<ChunkLore> {
  const parsed = parseChunkLore(lore);
  const blocked = validateChunkLoreStrings(parsed);
  if (blocked) {
    throw new Error(`lore content blocked: ${blocked}`);
  }
  const tier = modelTier === "T1" ? "T1" : "T0";

  const sql = getSql();
  if (!sql) {
    memoryLore.set(key(worldId, cx, cy), { lore: parsed, modelTier: tier });
    return parsed;
  }
  const loreJson = JSON.stringify(parsed);
  await sql`
    INSERT INTO world_chunk_lore (world_id, cx, cy, lore_json, model_tier, updated_at)
    VALUES (${worldId}, ${cx}, ${cy}, ${loreJson}, ${tier}, now())
    ON CONFLICT (world_id, cx, cy)
    DO UPDATE SET lore_json = EXCLUDED.lore_json, model_tier = EXCLUDED.model_tier, updated_at = now()
  `;
  return parsed;
}

export async function deleteChunkLore(
  worldId: string,
  cx: number,
  cy: number,
): Promise<void> {
  const sql = getSql();
  if (!sql) {
    memoryLore.delete(key(worldId, cx, cy));
    return;
  }
  await sql`
    DELETE FROM world_chunk_lore
    WHERE world_id = ${worldId} AND cx = ${cx} AND cy = ${cy}
  `;
}

/** Test helper */
export function clearChunkLoreMemory(): void {
  memoryLore.clear();
}
