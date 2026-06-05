ALTER TABLE npc_memories
  ADD COLUMN IF NOT EXISTS player_id text NOT NULL DEFAULT '__legacy__';

ALTER TABLE memory_summaries
  ADD COLUMN IF NOT EXISTS player_id text NOT NULL DEFAULT '__legacy__';

DROP INDEX IF EXISTS npc_memories_room_npc_created;
CREATE INDEX IF NOT EXISTS npc_memories_room_player_npc_created
  ON npc_memories (room_id, player_id, npc_id, created_at DESC);

DROP INDEX IF EXISTS memory_summaries_room_npc_created;
CREATE INDEX IF NOT EXISTS memory_summaries_room_player_npc_created
  ON memory_summaries (room_id, player_id, npc_id, created_at DESC);
