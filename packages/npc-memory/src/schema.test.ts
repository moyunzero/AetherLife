import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { EMBED_DIMENSIONS, npcMemories, npcRelationships } from "./schema.js";

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
