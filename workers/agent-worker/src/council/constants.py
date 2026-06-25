"""Council seat constants — mirror packages/shared/src/council/constants.ts."""

from __future__ import annotations

COUNCIL_NPC_IDS: tuple[str, ...] = tuple(f"npc-{i}" for i in range(1, 13))

COUNCIL_MEMORY_PLAYER_ID = "__council__"

TRAVELER_KEYWORD = "旅者"

VOTE_YES_THRESHOLD = 6

RELATIONSHIP_DELTA_ABS_MAX = 15
HISTORY_SUMMARY_DELTA_THRESHOLD = 8
