"""Council-scoped memory context fetch (PERSONA-04 stub for Phase 25 vote RAG)."""

from __future__ import annotations

from typing import Any

import httpx

from src.config import Settings
from src.memory.client import fetch_memory_context

COUNCIL_MEMORY_PLAYER_ID = "__council__"


def fetch_council_memory_context(
    client: httpx.Client,
    settings: Settings,
    room_id: str,
    query: str,
    *,
    npc_id: str = "npc-1",
    skip_embed: bool = False,
) -> dict[str, Any]:
    """Fetch RAG context from council LTM bucket (player_id=__council__)."""
    return fetch_memory_context(
        client,
        settings,
        room_id,
        query,
        npc_id=npc_id,
        player_id=COUNCIL_MEMORY_PLAYER_ID,
        skip_embed=skip_embed,
    )
