CREATE TABLE IF NOT EXISTS mutation_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id TEXT NOT NULL,
  npc_id TEXT NOT NULL,
  job_id TEXT,
  source TEXT NOT NULL DEFAULT 'executor',
  action_type TEXT NOT NULL,
  action_payload TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS mutation_audit_logs_room_created
  ON mutation_audit_logs (room_id, created_at DESC);
