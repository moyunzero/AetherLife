CREATE TABLE IF NOT EXISTS npc_personal_timeline (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id TEXT NOT NULL,
  npc_id TEXT NOT NULL,
  seq BIGINT NOT NULL,
  calendar_label TEXT NOT NULL,
  aether_epoch_minute INTEGER NOT NULL,
  tag TEXT NOT NULL CHECK (tag IN (
    'daily',
    'adventure',
    'emotion',
    'conflict',
    'reflection',
    'relationship',
    'council'
  )),
  body TEXT NOT NULL,
  event_anchor_id TEXT,
  factual_summary TEXT,
  proposal_eligible BOOLEAN NOT NULL DEFAULT FALSE,
  source TEXT NOT NULL CHECK (source IN (
    'seed',
    'llm_scheduled',
    'llm_event',
    'llm_reflection'
  )),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (room_id, npc_id, seq)
);

CREATE INDEX IF NOT EXISTS npc_personal_timeline_room_npc_seq_idx
  ON npc_personal_timeline (room_id, npc_id, seq DESC);

CREATE INDEX IF NOT EXISTS npc_personal_timeline_room_anchor_idx
  ON npc_personal_timeline (room_id, event_anchor_id);
