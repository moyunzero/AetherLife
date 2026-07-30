import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getTableColumns } from "drizzle-orm";
import {
  EMBED_DIMENSIONS,
  npcAttitudes,
  npcMemories,
  npcRelationships,
} from "./schema.js";

const migrationsDir = resolve(dirname(fileURLToPath(import.meta.url)), "../migrations");

describe("npcRelationships embedding (D-EMBED-02/03)", () => {
  it("locks EMBED_DIMENSIONS at 2048 for relationship vectors", () => {
    expect(EMBED_DIMENSIONS).toBe(2048);
  });

  it("exports npcRelationships.embedding typed like npcMemories.embedding", () => {
    const relCols = getTableColumns(npcRelationships);
    const memCols = getTableColumns(npcMemories);
    expect(relCols.embedding).toBeDefined();
    expect(memCols.embedding).toBeDefined();
    expect(relCols.embedding.name).toBe("embedding");
    expect(relCols.embedding.getSQLType()).toBe(`vector(${EMBED_DIMENSIONS})`);
    expect(relCols.embedding.getSQLType()).toBe(memCols.embedding.getSQLType());
  });

  it("migration 0012 adds nullable embedding vector(2048)", () => {
    const sql = readFileSync(
      resolve(migrationsDir, "0012_npc_relationships_embedding.sql"),
      "utf8",
    );
    expect(sql).toMatch(/ALTER TABLE\s+npc_relationships/i);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS\s+embedding\s+vector\(2048\)/i);
  });
});

describe("Phase 29 ANN + semantic attitudes (D-ANN / D-BELIEF)", () => {
  it("npcAttitudes exports currentMood, keyBeliefs, summary", () => {
    const cols = getTableColumns(npcAttitudes);
    expect(cols.currentMood).toBeDefined();
    expect(cols.currentMood.name).toBe("current_mood");
    expect(cols.keyBeliefs).toBeDefined();
    expect(cols.keyBeliefs.name).toBe("key_beliefs");
    expect(cols.summary).toBeDefined();
    expect(cols.summary.name).toBe("summary");
  });

  it("migration 0013 is halfvec HNSW without CONCURRENTLY", () => {
    const sql = readFileSync(
      resolve(migrationsDir, "0013_npc_memories_halfvec_index.sql"),
      "utf8",
    );
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS\s+npc_memories_embedding_halfvec_hnsw/i);
    expect(sql).toMatch(/halfvec\(2048\)/);
    expect(sql).toMatch(/halfvec_cosine_ops/);
    expect(sql).not.toMatch(/CREATE\s+INDEX\s+CONCURRENTLY/i);
    expect(sql).not.toMatch(/ON\s+npc_relationships/i);
  });

  it("migration 0014 adds mood/beliefs/summary with Chinese default mood", () => {
    const sql = readFileSync(
      resolve(migrationsDir, "0014_npc_attitudes_semantic_state.sql"),
      "utf8",
    );
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS\s+current_mood\s+text\s+DEFAULT\s+'平静'/i);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS\s+key_beliefs\s+jsonb/i);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS\s+summary\s+text\s+DEFAULT\s+''/i);
    expect(sql).not.toMatch(/CREATE\s+TABLE/i);
  });
});
