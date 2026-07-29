"""Council-scoped memory context fetch (PERSONA-04 stub for Phase 25 vote RAG)."""

from __future__ import annotations

from typing import Any

import httpx

from src.config import Settings
from src.council.personal_timeline_rag import (
    fetch_personal_timeline_context,
    merge_personal_rag_into_canon,
)
from src.council.relationship_rag import (
    fetch_relationship_rag_context,
    merge_relationship_rag_into_canon,
)
from src.council.world_history_rag import (
    fetch_world_history_canon_context,
    format_canon_bullet,
    format_council_bullet,
    merge_dual_rag_block,
    topic_relevant,
)
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


def fetch_dual_rag_context(
    client: httpx.Client,
    settings: Settings,
    room_id: str,
    query: str,
    *,
    npc_id: str = "npc-1",
    skip_embed: bool = False,
) -> dict[str, Any]:
    """Combine world_history canon + __council__ memory + personal timeline (BIO-09)."""
    canon_entries = fetch_world_history_canon_context(client, settings, room_id)
    skip_council_embed = skip_embed or not topic_relevant(query, canon_entries)
    council_ctx = fetch_council_memory_context(
        client,
        settings,
        room_id,
        query,
        npc_id=npc_id,
        skip_embed=skip_council_embed,
    )
    retrieved = list(council_ctx.get("retrieved") or [])
    canon_bullets = [format_canon_bullet(e) for e in canon_entries]
    council_bullets = [format_council_bullet(r) for r in retrieved if format_council_bullet(r)]
    canon_context = merge_dual_rag_block(
        query,
        canon_bullets=canon_bullets,
        council_bullets=council_bullets,
        canon_entries=canon_entries,
    )
    personal_bullets: list[str] = []
    relationship_bullets: list[str] = []
    if npc_id.startswith("npc-"):
        personal_bullets = fetch_personal_timeline_context(
            client,
            settings,
            room_id,
            npc_id,
            query,
        )
        canon_context = merge_personal_rag_into_canon(canon_context, personal_bullets)
        relationship_bullets = fetch_relationship_rag_context(
            client,
            settings,
            room_id,
            npc_id,
            query,
        )
        canon_context = merge_relationship_rag_into_canon(canon_context, relationship_bullets)
    return {
        "canon_context": canon_context,
        "canon_entries": canon_entries,
        "council_retrieved": retrieved,
        "personal_timeline_bullets": personal_bullets,
        "relationship_rag_bullets": relationship_bullets,
    }
