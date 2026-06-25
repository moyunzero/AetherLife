CREATE TABLE IF NOT EXISTS world_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id TEXT NOT NULL,
  sequence BIGINT NOT NULL,
  entry_kind TEXT NOT NULL CHECK (entry_kind IN ('genesis', 'vote')),
  status TEXT NOT NULL CHECK (status IN ('accepted', 'rejected')),
  title TEXT NOT NULL,
  proposal TEXT NOT NULL,
  proposer_npc_id TEXT,
  proposer_display_name TEXT NOT NULL,
  yes_count INTEGER,
  no_count INTEGER,
  minutes_json JSONB NOT NULL,
  game_year INTEGER NOT NULL,
  game_minute_snapshot INTEGER NOT NULL,
  vote_epoch TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (room_id, sequence),
  UNIQUE (room_id, vote_epoch)
);

CREATE INDEX IF NOT EXISTS world_history_room_year_seq_idx
  ON world_history (room_id, game_year, sequence DESC);

CREATE INDEX IF NOT EXISTS world_history_room_status_year_idx
  ON world_history (room_id, status, game_year, sequence DESC);
