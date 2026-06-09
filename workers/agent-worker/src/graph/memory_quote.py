import re
from typing import Any

from src.graph.recall_merge import DEFAULT_RECALL_MIN_SCORE, best_retrieved_memory

_ROLE_PREFIX = re.compile(r"^(?:player|npc)\s*:\s*", re.IGNORECASE)
_MAX_WIRE_CHARS = 500


def _strip_role_prefix(text: str) -> str:
    return _ROLE_PREFIX.sub("", text.strip()).strip()


def pick_memory_quote(
    retrieved_memories: list[dict[str, Any]] | None,
    memory_count: int,
    *,
    min_score: float = DEFAULT_RECALL_MIN_SCORE,
) -> str | None:
    if memory_count <= 0:
        return None
    best = best_retrieved_memory(retrieved_memories, min_score=min_score)
    if best is None:
        return None
    raw = str(best.get("text") or "").strip()
    if not raw:
        return None
    quote = _strip_role_prefix(raw)
    if not quote:
        return None
    return quote[:_MAX_WIRE_CHARS]
