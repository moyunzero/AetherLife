-- Phase 29 D-BELIEF-01/02: additive Semantic state on npc_attitudes (columns only; no fact triples).
-- Defaults preserve existing upserts (applyReputationDelta sets reputation only).
ALTER TABLE npc_attitudes
  ADD COLUMN IF NOT EXISTS current_mood text DEFAULT '平静';
ALTER TABLE npc_attitudes
  ADD COLUMN IF NOT EXISTS key_beliefs jsonb DEFAULT '[]'::jsonb;
ALTER TABLE npc_attitudes
  ADD COLUMN IF NOT EXISTS summary text DEFAULT '';
