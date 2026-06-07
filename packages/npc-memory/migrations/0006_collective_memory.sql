CREATE TABLE IF NOT EXISTS collective_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id TEXT NOT NULL,
  npc_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  summary TEXT NOT NULL,
  player_ids TEXT[] NOT NULL,
  delta_score INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'rule',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS collective_events_room_npc_created_idx
  ON collective_events (room_id, npc_id, created_at DESC);

CREATE INDEX IF NOT EXISTS collective_events_room_created_idx
  ON collective_events (room_id, created_at DESC);

CREATE TABLE IF NOT EXISTS npc_attitudes (
  room_id TEXT NOT NULL,
  npc_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  reputation INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (room_id, npc_id, player_id)
);

CREATE INDEX IF NOT EXISTS npc_attitudes_room_player_idx
  ON npc_attitudes (room_id, player_id);
