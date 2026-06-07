from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator

from src.persistence.pg_kwargs import PG_CONNECT_KWARGS

_pool = None


def _conninfo() -> str:
    from src.collective.repository import _require_database_url

    return _require_database_url()


def get_pool():
    """Lazy singleton pool — caps worker collective DB sessions (Supabase pool_size)."""
    global _pool
    if _pool is not None:
        return _pool

    from psycopg_pool import ConnectionPool

    _pool = ConnectionPool(
        conninfo=_conninfo(),
        min_size=0,
        max_size=2,
        max_idle=30,
        kwargs={"autocommit": False, **PG_CONNECT_KWARGS},
    )
    return _pool


@contextmanager
def collective_connection() -> Iterator:
    with get_pool().connection() as conn:
        yield conn


def reset_pool_for_tests() -> None:
    global _pool
    if _pool is not None:
        _pool.close()
        _pool = None
