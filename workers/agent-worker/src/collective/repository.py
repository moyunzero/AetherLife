from __future__ import annotations

import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from psycopg.cursor import Cursor

from .constants import COLLECTIVE_EVENT_KINDS, COLLECTIVE_EVENT_TTL_MS, DEFAULT_COLLECTIVE_WINDOW_MS, NPC_PERSONALITY_SEED
from .db_pool import collective_connection
from .scoring import clamp_attitude_score, compute_witness_deltas

_in_memory_events: list[dict[str, Any]] = []
_in_memory_attitudes: list[dict[str, Any]] = []


def _database_url() -> str | None:
    """Pydantic loads .env into Settings; os.environ may still lack DATABASE_URL."""
    url = os.getenv("DATABASE_URL")
    if url:
        return url
    try:
        from src.config import get_settings

        return get_settings().database_url
    except Exception:
        return None


def _use_in_memory() -> bool:
    return os.getenv("LLM_MOCK") == "1" or not _database_url()


def _require_database_url() -> str:
    url = _database_url()
    if not url:
        raise RuntimeError("DATABASE_URL is required for collective persistence")
    return url


def _personality_seed(npc_id: str) -> int:
    return NPC_PERSONALITY_SEED.get(npc_id, 0)


def _read_attitude(cur: Cursor, room_id: str, npc_id: str, player_id: str) -> int | None:
    cur.execute(
        """
        SELECT reputation FROM npc_attitudes
        WHERE room_id = %s AND npc_id = %s AND player_id = %s
        LIMIT 1
        """,
        (room_id, npc_id, player_id),
    )
    row = cur.fetchone()
    return int(row[0]) if row else None


def _upsert_reputation(
    cur: Cursor,
    room_id: str,
    npc_id: str,
    player_id: str,
    reputation: int,
) -> None:
    cur.execute(
        """
        INSERT INTO npc_attitudes (room_id, npc_id, player_id, reputation, updated_at)
        VALUES (%s, %s, %s, %s, NOW())
        ON CONFLICT (room_id, npc_id, player_id)
        DO UPDATE SET reputation = EXCLUDED.reputation, updated_at = NOW()
        """,
        (room_id, npc_id, player_id, reputation),
    )


def _apply_reputation_delta_on_cursor(
    cur: Cursor,
    room_id: str,
    npc_id: str,
    player_id: str,
    delta: int,
) -> int:
    existing = _read_attitude(cur, room_id, npc_id, player_id)
    base = existing if existing is not None else _personality_seed(npc_id)
    next_score = clamp_attitude_score(base + delta)
    _upsert_reputation(cur, room_id, npc_id, player_id, next_score)
    return next_score


class CollectiveRepository:
    def insert_worker_event(
        self,
        *,
        room_id: str,
        npc_id: str,
        kind: str,
        summary: str,
        player_ids: list[str],
        delta_score: int,
        npc_positions: dict[str, tuple[int, int]],
    ) -> str:
        if kind not in COLLECTIVE_EVENT_KINDS:
            raise ValueError(f"invalid collective kind: {kind}")

        event_id = str(uuid.uuid4())
        row = {
            "id": event_id,
            "room_id": room_id,
            "npc_id": npc_id,
            "kind": kind,
            "summary": summary[:500],
            "player_ids": list(player_ids),
            "delta_score": delta_score,
            "source": "worker",
            "created_at": datetime.now(timezone.utc),
        }

        witness_updates = compute_witness_deltas(
            kind=kind,
            delta_score=delta_score,
            player_ids=player_ids,
            target_npc_id=npc_id,
            npc_positions=npc_positions,
        )

        if _use_in_memory():
            _in_memory_events.append(row)
            for witness_npc_id, witness_player_id, witness_delta in witness_updates:
                self.apply_reputation_delta(
                    room_id,
                    witness_npc_id,
                    witness_player_id,
                    witness_delta,
                )
            return event_id

        with collective_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO collective_events
                      (id, room_id, npc_id, kind, summary, player_ids, delta_score, source, created_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, 'worker', NOW())
                    """,
                    (
                        event_id,
                        room_id,
                        npc_id,
                        kind,
                        summary[:500],
                        player_ids,
                        delta_score,
                    ),
                )
                for witness_npc_id, witness_player_id, witness_delta in witness_updates:
                    _apply_reputation_delta_on_cursor(
                        cur,
                        room_id,
                        witness_npc_id,
                        witness_player_id,
                        witness_delta,
                    )
            conn.commit()
        return event_id

    def list_window_deltas(self, room_id: str, npc_id: str) -> list[int]:
        window_ms = DEFAULT_COLLECTIVE_WINDOW_MS
        cutoff = datetime.now(timezone.utc) - timedelta(milliseconds=window_ms)
        if _use_in_memory():
            return [
                int(e["delta_score"])
                for e in _in_memory_events
                if e["room_id"] == room_id
                and e["npc_id"] == npc_id
                and e["created_at"] >= cutoff
            ]

        with collective_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT delta_score FROM collective_events
                    WHERE room_id = %s AND npc_id = %s AND created_at >= %s
                    ORDER BY created_at DESC
                    """,
                    (room_id, npc_id, cutoff),
                )
                rows = cur.fetchall()
        return [int(row[0]) for row in rows]

    def insert_refined_event(
        self,
        *,
        room_id: str,
        npc_id: str,
        kind: str,
        summary: str,
        player_ids: list[str],
        delta_score: int,
    ) -> str:
        if kind not in COLLECTIVE_EVENT_KINDS:
            raise ValueError(f"invalid collective kind: {kind}")

        event_id = str(uuid.uuid4())
        row = {
            "id": event_id,
            "room_id": room_id,
            "npc_id": npc_id,
            "kind": kind,
            "summary": summary[:500],
            "player_ids": list(player_ids),
            "delta_score": delta_score,
            "source": "llm_refine",
            "created_at": datetime.now(timezone.utc),
        }

        if _use_in_memory():
            _in_memory_events.append(row)
            for player_id in player_ids:
                self.apply_reputation_delta(room_id, npc_id, player_id, delta_score)
            return event_id

        with collective_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO collective_events
                      (id, room_id, npc_id, kind, summary, player_ids, delta_score, source, created_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, 'llm_refine', NOW())
                    """,
                    (
                        event_id,
                        room_id,
                        npc_id,
                        kind,
                        summary[:500],
                        player_ids,
                        delta_score,
                    ),
                )
                for player_id in player_ids:
                    _apply_reputation_delta_on_cursor(
                        cur, room_id, npc_id, player_id, delta_score
                    )
            conn.commit()
        return event_id

    def apply_reputation_delta(
        self,
        room_id: str,
        npc_id: str,
        player_id: str,
        delta: int,
    ) -> int:
        existing = self.get_attitude(room_id, npc_id, player_id)
        base = existing if existing is not None else _personality_seed(npc_id)
        next_score = clamp_attitude_score(base + delta)
        now = datetime.now(timezone.utc)

        if _use_in_memory():
            for row in _in_memory_attitudes:
                if (
                    row["room_id"] == room_id
                    and row["npc_id"] == npc_id
                    and row["player_id"] == player_id
                ):
                    row["reputation"] = next_score
                    row["updated_at"] = now
                    return next_score
            _in_memory_attitudes.append(
                {
                    "room_id": room_id,
                    "npc_id": npc_id,
                    "player_id": player_id,
                    "reputation": next_score,
                    "updated_at": now,
                },
            )
            return next_score

        with collective_connection() as conn:
            with conn.cursor() as cur:
                _upsert_reputation(cur, room_id, npc_id, player_id, next_score)
            conn.commit()
        return next_score

    def get_attitude(self, room_id: str, npc_id: str, player_id: str) -> int | None:
        if _use_in_memory():
            for row in _in_memory_attitudes:
                if (
                    row["room_id"] == room_id
                    and row["npc_id"] == npc_id
                    and row["player_id"] == player_id
                ):
                    return int(row["reputation"])
            return None

        with collective_connection() as conn:
            with conn.cursor() as cur:
                return _read_attitude(cur, room_id, npc_id, player_id)

    def delete_for_room(self, room_id: str) -> None:
        if _use_in_memory():
            global _in_memory_events, _in_memory_attitudes
            _in_memory_events = [e for e in _in_memory_events if e["room_id"] != room_id]
            _in_memory_attitudes = [a for a in _in_memory_attitudes if a["room_id"] != room_id]
            return

        with collective_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM collective_events WHERE room_id = %s", (room_id,))
                cur.execute("DELETE FROM npc_attitudes WHERE room_id = %s", (room_id,))
            conn.commit()

    def prune_expired(self) -> None:
        cutoff = datetime.now(timezone.utc) - timedelta(milliseconds=COLLECTIVE_EVENT_TTL_MS)
        if _use_in_memory():
            global _in_memory_events
            _in_memory_events = [e for e in _in_memory_events if e["created_at"] >= cutoff]
            return

        with collective_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "DELETE FROM collective_events WHERE created_at < %s",
                    (cutoff,),
                )
            conn.commit()


def reset_in_memory_store() -> None:
    global _in_memory_events, _in_memory_attitudes
    _in_memory_events = []
    _in_memory_attitudes = []
