-- Align legacy default npc_id '1' with DEFAULT_NPC_ID ('npc-1') from @aetherlife/shared
UPDATE npc_memories SET npc_id = 'npc-1' WHERE npc_id = '1';
UPDATE memory_summaries SET npc_id = 'npc-1' WHERE npc_id = '1';

ALTER TABLE npc_memories ALTER COLUMN npc_id SET DEFAULT 'npc-1';
ALTER TABLE memory_summaries ALTER COLUMN npc_id SET DEFAULT 'npc-1';
