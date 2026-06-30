"""REL-08 speak leaningDrift persistence (worker-only write path)."""

from __future__ import annotations

import os
import re
from typing import Any

from src.council.registry import get_persona

SINGLE_DELTA_MAX = 2
DAY_DELTA_CAP = 6
TOTAL_DRIFT_MIN = -30
TOTAL_DRIFT_MAX = 30

_LEANING_BASE_SCORE = {"against": -40, "swing": 0, "for": 40}

_in_memory_rows: dict[tuple[str, str], dict[str, int]] = {}

_POSITIVE_MARKERS = (
    "谢谢",
    "感谢",
    "赞成",
    "支持",
    "同意",
    "好",
    "棒",
    "喜欢",
    "信任",
    "辛苦",
)
_NEGATIVE_MARKERS = (
    "讨厌",
    "反对",
    "滚",
    "蠢",
    "恨",
    "不行",
    "拒绝",
    "骗子",
    "废物",
    "闭嘴",
)


def game_day_bucket(game_minute: int) -> int:
    """480-minute buckets within a 1440-minute game day (aligns with ambient_intent)."""
    minute = int(game_minute) % 1440
    return minute // 480


def _pack_day_bucket_applied(day_bucket: int, daily_abs: int) -> int:
    return day_bucket * 100 + daily_abs


def _unpack_day_bucket_applied(packed: int) -> tuple[int, int]:
    return packed // 100, packed % 100


def _database_url() -> str | None:
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


def _clamp_single_delta(delta: int) -> int:
    if delta == 0:
        return 0
    sign = -1 if delta < 0 else 1
    return sign * min(SINGLE_DELTA_MAX, abs(int(delta)))


def _cap_daily_delta(requested: int, day_bucket: int, packed: int) -> int:
    stored_bucket, daily_abs = _unpack_day_bucket_applied(packed)
    if stored_bucket != day_bucket:
        daily_abs = 0
    remaining = DAY_DELTA_CAP - daily_abs
    if remaining <= 0:
        return 0
    sign = -1 if requested < 0 else 1
    return sign * min(abs(requested), remaining)


def _cap_total_drift(current: int, requested: int) -> int:
    if requested == 0:
        return 0
    next_drift = current + requested
    if next_drift > TOTAL_DRIFT_MAX:
        return TOTAL_DRIFT_MAX - current
    if next_drift < TOTAL_DRIFT_MIN:
        return TOTAL_DRIFT_MIN - current
    return requested


def _read_row(room_id: str, npc_id: str) -> dict[str, int] | None:
    key = (room_id, npc_id)
    if _use_in_memory():
        return _in_memory_rows.get(key)

    from src.collective.db_pool import collective_connection

    with collective_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT drift, day_bucket_applied
                FROM npc_leaning_drift
                WHERE room_id = %s AND npc_id = %s
                LIMIT 1
                """,
                (room_id, npc_id),
            )
            row = cur.fetchone()
            if not row:
                return None
            return {"drift": int(row[0]), "day_bucket_applied": int(row[1])}


def _write_row(
    room_id: str,
    npc_id: str,
    *,
    drift: int,
    day_bucket_applied: int,
) -> None:
    key = (room_id, npc_id)
    if _use_in_memory():
        _in_memory_rows[key] = {
            "drift": drift,
            "day_bucket_applied": day_bucket_applied,
        }
        return

    from src.collective.db_pool import collective_connection

    with collective_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO npc_leaning_drift (room_id, npc_id, drift, day_bucket_applied)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (room_id, npc_id)
                DO UPDATE SET
                  drift = EXCLUDED.drift,
                  day_bucket_applied = EXCLUDED.day_bucket_applied
                """,
                (room_id, npc_id, drift, day_bucket_applied),
            )
        conn.commit()


def apply_speak_leaning_drift(
    room_id: str,
    npc_id: str,
    sentiment_delta: int,
    *,
    game_minute: int = 0,
) -> int:
    """Apply clamped drift after speak; returns signed delta actually applied (0 if rejected)."""
    requested = _clamp_single_delta(sentiment_delta)
    if requested == 0:
        return 0

    day_bucket = game_day_bucket(game_minute)
    row = _read_row(room_id, npc_id) or {"drift": 0, "day_bucket_applied": 0}
    current_drift = int(row["drift"])
    packed = int(row["day_bucket_applied"])

    daily_allowed = _cap_daily_delta(requested, day_bucket, packed)
    if daily_allowed == 0:
        return 0

    applied = _cap_total_drift(current_drift, daily_allowed)
    if applied == 0:
        return 0

    stored_bucket, daily_abs = _unpack_day_bucket_applied(packed)
    if stored_bucket != day_bucket:
        daily_abs = 0
    next_packed = _pack_day_bucket_applied(day_bucket, daily_abs + abs(applied))
    _write_row(
        room_id,
        npc_id,
        drift=current_drift + applied,
        day_bucket_applied=next_packed,
    )
    return applied


def get_leaning_drift(room_id: str, npc_id: str) -> int:
    row = _read_row(room_id, npc_id)
    return int(row["drift"]) if row else 0


def effective_leaning_score(npc_id: str, drift: int) -> int:
    persona = get_persona(npc_id)
    base = _LEANING_BASE_SCORE.get((persona or {}).get("votingLeaning", "swing"), 0)
    return max(-100, min(100, base + int(drift)))


def effective_voting_leaning(npc_id: str, drift: int) -> str:
    score = effective_leaning_score(npc_id, drift)
    if score >= 20:
        return "for"
    if score <= -20:
        return "against"
    return "swing"


def clear_leaning_drift_store_for_tests() -> None:
    _in_memory_rows.clear()


def estimate_speak_sentiment_delta(player_message: str) -> int:
    """Heuristic ±1/±2 from player message polarity (no LLM)."""
    text = (player_message or "").strip()
    if not text:
        return 0
    pos = sum(1 for marker in _POSITIVE_MARKERS if marker in text)
    neg = sum(1 for marker in _NEGATIVE_MARKERS if marker in text)
    score = pos - neg
    if score >= 2:
        return 2
    if score == 1:
        return 1
    if score <= -2:
        return -2
    if score == -1:
        return -1
    if re.search(r"[！!]{2,}", text):
        return -1
    if re.search(r"[？?]{2,}", text):
        return 1
    return 0


def fetch_room_leaning_drifts(room_id: str, npc_ids: list[str]) -> dict[str, int]:
    if not npc_ids:
        return {}
    if _use_in_memory():
        return {npc_id: get_leaning_drift(room_id, npc_id) for npc_id in npc_ids}

    from src.collective.db_pool import collective_connection

    out: dict[str, int] = {npc_id: 0 for npc_id in npc_ids}
    with collective_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT npc_id, drift
                FROM npc_leaning_drift
                WHERE room_id = %s AND npc_id = ANY(%s)
                """,
                (room_id, npc_ids),
            )
            for npc_id, drift in cur.fetchall():
                out[str(npc_id)] = int(drift)
    return out
