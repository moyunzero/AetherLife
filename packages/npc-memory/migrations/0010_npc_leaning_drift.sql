CREATE TABLE IF NOT EXISTS npc_leaning_drift (
  room_id TEXT NOT NULL,
  npc_id TEXT NOT NULL,
  drift SMALLINT NOT NULL DEFAULT 0,
  day_bucket_applied INT NOT NULL DEFAULT 0,
  PRIMARY KEY (room_id, npc_id),
  CHECK (drift BETWEEN -30 AND 30),
  CHECK (day_bucket_applied >= 0)
);

CREATE INDEX IF NOT EXISTS npc_leaning_drift_room_idx
  ON npc_leaning_drift (room_id);
