CREATE TABLE IF NOT EXISTS world_chunks (
  world_id text NOT NULL,
  cx integer NOT NULL,
  cy integer NOT NULL,
  delta_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (world_id, cx, cy)
);

CREATE INDEX IF NOT EXISTS world_chunks_world_updated
  ON world_chunks (world_id, updated_at DESC);
