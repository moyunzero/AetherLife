CREATE TABLE IF NOT EXISTS npc_relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id TEXT NOT NULL,
  npc_a_id TEXT NOT NULL,
  npc_b_id TEXT NOT NULL,
  base_tag TEXT NOT NULL,
  affection INTEGER NOT NULL DEFAULT 0,
  trust INTEGER NOT NULL DEFAULT 50,
  interaction_count INTEGER NOT NULL DEFAULT 0,
  last_interact_at TIMESTAMPTZ,
  current_status JSONB NOT NULL DEFAULT '[]'::jsonb,
  history_summary TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (room_id, npc_a_id, npc_b_id),
  CHECK (npc_a_id < npc_b_id),
  CHECK (affection >= -100 AND affection <= 100),
  CHECK (trust >= 0 AND trust <= 100)
);

CREATE INDEX IF NOT EXISTS npc_relationships_room_idx
  ON npc_relationships (room_id);

CREATE INDEX IF NOT EXISTS npc_relationships_room_npc_a_idx
  ON npc_relationships (room_id, npc_a_id);

CREATE INDEX IF NOT EXISTS npc_relationships_room_npc_b_idx
  ON npc_relationships (room_id, npc_b_id);
