from typing import Any

import httpx

from src.config import Settings, get_settings
from src.llm.openrouter_chat import invoke_chat_llm
from src.llm.roles import summarize_provider_model
from src.memory.client import fetch_oldest_memories, store_bulk_summary


def run_bulk_summarize_llm(texts: list[str], settings: Settings | None = None) -> str:
    cfg = settings or get_settings()
    joined = "\n".join(f"- {t}" for t in texts if t.strip())

    if cfg.llm_mock:
        return f"Bulk summary of {len(texts)} memories: " + "; ".join(texts[:5])

    provider, model = summarize_provider_model(cfg)
    content = invoke_chat_llm(
        [
            {
                "role": "system",
                "content": (
                    "Merge these old NPC memories into a concise summary. "
                    "Keep proper nouns, codes, and markers like FACT-* verbatim."
                ),
            },
            {"role": "user", "content": joined or "(empty)"},
        ],
        settings=cfg,
        provider=provider,
        model=model,
    )
    return content.strip()


def maybe_bulk_summarize(
    client: httpx.Client,
    settings: Settings,
    room_id: str,
    memory_count: int,
    *,
    npc_id: str = "npc-1",
    player_id: str = "__legacy__",
) -> bool:
    if memory_count < settings.summarize_threshold:
        return False

    batch = fetch_oldest_memories(
        client,
        settings,
        room_id,
        limit=settings.summarize_batch_size,
        npc_id=npc_id,
        player_id=player_id,
    )
    if not batch:
        return False

    texts = [row.get("text", "") for row in batch if row.get("text")]
    summary = run_bulk_summarize_llm(texts, settings)
    mark_ids = [row["id"] for row in batch if row.get("id")]
    store_bulk_summary(
        client,
        settings,
        room_id,
        summary,
        mark_ids,
        npc_id=npc_id,
        player_id=player_id,
        source_count=len(mark_ids),
    )
    return True
