CREATE TABLE IF NOT EXISTS world_chunk_lore (
  world_id text NOT NULL,
  cx integer NOT NULL,
  cy integer NOT NULL,
  lore_json jsonb NOT NULL,
  model_tier text NOT NULL DEFAULT 'T0',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (world_id, cx, cy)
);

CREATE INDEX IF NOT EXISTS world_chunk_lore_world_updated
  ON world_chunk_lore (world_id, updated_at DESC);
