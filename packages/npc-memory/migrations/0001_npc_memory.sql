CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS npc_memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id text NOT NULL,
  npc_id text NOT NULL DEFAULT '1',
  text text NOT NULL,
  importance real NOT NULL DEFAULT 5,
  embedding vector(2048),
  summarized_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS npc_memories_room_npc_created
  ON npc_memories (room_id, npc_id, created_at DESC);

-- HNSW max 2000 dims; free embed model is 2048 — skip ANN index until Phase 4 tuning

CREATE TABLE IF NOT EXISTS memory_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id text NOT NULL,
  npc_id text NOT NULL DEFAULT '1',
  kind text NOT NULL,
  text text NOT NULL,
  source_count integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS memory_summaries_room_npc_created
  ON memory_summaries (room_id, npc_id, created_at DESC);
