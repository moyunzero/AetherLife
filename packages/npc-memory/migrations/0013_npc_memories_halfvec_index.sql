-- Phase 29 D-ANN-01/06: halfvec(2048) expression HNSW on npc_memories.
-- Column type stays vector(2048); no re-embed. Transactional migrate (no concurrent build).
-- Relationships embedding is intentionally unindexed (D-ANN-05).
-- Probe gate: pnpm verify:pgvector must PASS (pgvector >= 0.7 + halfvec).
CREATE INDEX IF NOT EXISTS npc_memories_embedding_halfvec_hnsw
  ON npc_memories
  USING hnsw ((embedding::halfvec(2048)) halfvec_cosine_ops);
