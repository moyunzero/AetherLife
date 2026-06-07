import os
from typing import Any

from langgraph.checkpoint.memory import MemorySaver

from src.persistence.pg_kwargs import PG_CONNECT_KWARGS

_checkpointer: Any | None = None
_checkpointer_conn: Any | None = None


def setup_checkpointer(
    *,
    database_url: str | None = None,
    allow_memory_fallback: bool = False,
) -> Any:
    """Initialize PostgresSaver when DATABASE_URL is set; call once at worker boot."""
    global _checkpointer, _checkpointer_conn
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
        from psycopg import Connection
        from psycopg.rows import dict_row
    except ImportError as exc:
        raise RuntimeError(
            "PostgresSaver unavailable — install psycopg[binary] "
            "(uv sync in workers/agent-worker)"
        ) from exc

    # LangGraph from_conn_string uses prepare_threshold=0; transaction pooler needs None.
    global _checkpointer_conn
    _checkpointer_conn = Connection.connect(
        database_url,
        autocommit=True,
        row_factory=dict_row,
        **PG_CONNECT_KWARGS,
    )
    saver = PostgresSaver(_checkpointer_conn)
    saver.setup()
    _checkpointer = saver
    return _checkpointer


def get_checkpointer(*, allow_memory_fallback: bool = True) -> Any:
    global _checkpointer
    if _checkpointer is not None:
        return _checkpointer
    return setup_checkpointer(allow_memory_fallback=allow_memory_fallback)


def reset_checkpointer_for_tests() -> None:
    global _checkpointer, _checkpointer_conn
    if _checkpointer_conn is not None:
        _checkpointer_conn.close()
    _checkpointer = None
    _checkpointer_conn = None
