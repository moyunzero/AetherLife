-- Phase 28 D-EMBED-02/03: nullable edge embedding for Speak RAG (matches EMBED_DIMENSIONS=2048).
-- Optional HNSW index deferred (MVP: ~66 edges/room).
ALTER TABLE npc_relationships
  ADD COLUMN IF NOT EXISTS embedding vector(2048);
