"""Worker-state HTTP fetch + hot/stale snapshot cache (extracted from npc_loop)."""

from __future__ import annotations

import sys
import time
from typing import Any

import httpx

from src.config import Settings
from src.graph.job_context import record_phase_ms
from src.graph.state import GraphState
from src.http_json import safe_response_json

_FETCH_STATE_TIMEOUT_S = 6.0
_FETCH_STATE_ATTEMPTS = 2
_FETCH_STATE_HOT_CACHE_TTL_S = 3.0
_STALE_SNAPSHOT_TTL_S = 300.0
_stale_worker_snapshots: dict[str, tuple[dict[str, Any], float]] = {}


def _game_headers(settings: Settings) -> dict[str, str]:
    headers: dict[str, str] = {}
    if settings.internal_worker_token:
        headers["Authorization"] = f"Bearer {settings.internal_worker_token}"
    return headers


def _player_id(state: GraphState) -> str:
    return state.get("player_id") or "__legacy__"


def _worker_state_stale_key(room_id: str, player_id: str) -> str:
    return f"{room_id}:{player_id}"


def _remember_worker_snapshot(room_id: str, player_id: str, snapshot: dict[str, Any]) -> None:
    clean = {k: v for k, v in snapshot.items() if not str(k).startswith("_")}
    _stale_worker_snapshots[_worker_state_stale_key(room_id, player_id)] = (
        clean,
        time.time(),
    )


def _stale_worker_snapshot(room_id: str, player_id: str) -> dict[str, Any] | None:
    entry = _stale_worker_snapshots.get(_worker_state_stale_key(room_id, player_id))
    if not entry:
        return None
    snap, ts = entry
    if time.time() - ts > _STALE_SNAPSHOT_TTL_S:
        return None
    age_ms = int((time.time() - ts) * 1000)
    return {**snap, "_stale": True, "_stale_age_ms": age_ms}


def _hot_worker_snapshot(room_id: str, player_id: str) -> dict[str, Any] | None:
    """Fresh worker-state snapshot within hot TTL — skip HTTP on back-to-back speaks."""
    entry = _stale_worker_snapshots.get(_worker_state_stale_key(room_id, player_id))
    if not entry:
        return None
    snap, ts = entry
    age_s = time.time() - ts
    if age_s > _FETCH_STATE_HOT_CACHE_TTL_S:
        return None
    age_ms = int(age_s * 1000)
    return {**snap, "_cache_hit": True, "_cache_age_ms": age_ms}


def fetch_state(
    state: GraphState,
    *,
    settings: Settings,
    client: httpx.Client,
    skip_nearby_lore: bool = False,
) -> GraphState:
    room_id = state["room_id"]
    headers = _game_headers(settings)
    player_id = _player_id(state)
    if player_id and player_id != "__legacy__":
        headers["X-Player-Id"] = player_id
    url = f"{settings.game_server_url}/internal/rooms/{room_id}/worker-state"
    if skip_nearby_lore:
        url = f"{url}?skipNearbyLore=1"
    hot = _hot_worker_snapshot(room_id, player_id)
    if hot is not None:
        age_ms = int(hot.pop("_cache_age_ms", 0))
        hot.pop("_cache_hit", None)
        record_phase_ms("t_fetch_state_ms", 0)
        record_phase_ms("t_fetch_state_cache_age_ms", age_ms)
        return {**state, "room_snapshot": hot}
    last_exc: BaseException | None = None
    for attempt in range(_FETCH_STATE_ATTEMPTS):
        try:
            res = client.get(url, headers=headers, timeout=_FETCH_STATE_TIMEOUT_S)
            res.raise_for_status()
            body = safe_response_json(res)
            snapshot = body.get("state", {}) or {}
            nearby = body.get("nearbyLore")
            if nearby is not None:
                snapshot = {**snapshot, "nearbyLore": nearby}
            _remember_worker_snapshot(room_id, player_id, snapshot)
            return {**state, "room_snapshot": snapshot}
        except httpx.TimeoutException as exc:
            last_exc = exc
            print(
                f"worker-state timeout room={room_id} attempt={attempt + 1}/{_FETCH_STATE_ATTEMPTS}",
                file=sys.stderr,
            )
            if attempt + 1 < _FETCH_STATE_ATTEMPTS:
                time.sleep(0.5 + attempt)
                continue
            stale = _stale_worker_snapshot(room_id, player_id)
            if stale is not None:
                age_ms = int(stale.get("_stale_age_ms") or 0)
                print(
                    f"worker-state stale-fallback room={room_id} age_ms={age_ms}",
                    file=sys.stderr,
                )
                record_phase_ms("t_worker_state_stale_ms", age_ms)
                return {**state, "room_snapshot": stale}
            raise
    if last_exc is not None:
        raise last_exc
    raise RuntimeError("fetch_state retry loop exited without response")
