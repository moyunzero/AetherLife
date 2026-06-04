import os
from typing import Any

from langgraph.checkpoint.memory import MemorySaver

_checkpointer: Any | None = None
_saver_cm: Any | None = None


def setup_checkpointer(
    *,
    database_url: str | None = None,
    allow_memory_fallback: bool = False,
) -> Any:
    """Initialize PostgresSaver when DATABASE_URL is set; call once at worker boot."""
    global _checkpointer, _saver_cm
    if _checkpointer is not None:
        return _checkpointer

    database_url = database_url or os.getenv("DATABASE_URL")
    if not database_url:
        if allow_memory_fallback or os.getenv("LLM_MOCK") == "1":
            _checkpointer = MemorySaver()
            return _checkpointer
        raise RuntimeError("DATABASE_URL is required for PostgresSaver (Phase 3)")

    try:
        from langgraph.checkpoint.postgres import PostgresSaver
    except ImportError as exc:
        raise RuntimeError(
            "PostgresSaver unavailable — install psycopg[binary] "
            "(uv sync in workers/agent-worker)"
        ) from exc

    # Must keep the context manager alive — exiting closes the psycopg connection.
    _saver_cm = PostgresSaver.from_conn_string(database_url)
    saver = _saver_cm.__enter__()
    saver.setup()
    _checkpointer = saver
    return _checkpointer


def get_checkpointer(*, allow_memory_fallback: bool = True) -> Any:
    global _checkpointer
    if _checkpointer is not None:
        return _checkpointer
    return setup_checkpointer(allow_memory_fallback=allow_memory_fallback)


def reset_checkpointer_for_tests() -> None:
    global _checkpointer, _saver_cm
    if _saver_cm is not None:
        _saver_cm.__exit__(None, None, None)
    _checkpointer = None
    _saver_cm = None
