import time
from typing import Any

import httpx

from src.config import Settings

_RETRYABLE_HTTP = frozenset({502, 503, 504})
_MEMORY_CONTEXT_TIMEOUT_S = 45.0
_MEMORY_CONTEXT_INTERACTIVE_TIMEOUT_S = 18.0


def _game_headers(settings: Settings) -> dict[str, str]:
    headers: dict[str, str] = {}
    if settings.internal_worker_token:
        headers["Authorization"] = f"Bearer {settings.internal_worker_token}"
    return headers


def _get_with_retry(
    client: httpx.Client,
    url: str,
    *,
    params: dict[str, str] | None = None,
    headers: dict[str, str] | None = None,
    timeout: float,
    attempts: int = 3,
) -> httpx.Response:
    last: httpx.HTTPStatusError | None = None
    for attempt in range(attempts):
        res = client.get(url, params=params, headers=headers, timeout=timeout)
        try:
            res.raise_for_status()
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code not in _RETRYABLE_HTTP or attempt >= attempts - 1:
                raise
            last = exc
            time.sleep(1 + attempt)
            continue
        return res
    if last is not None:
        raise last
    raise RuntimeError("retry loop exited without response")


def fetch_memory_context(
    client: httpx.Client,
    settings: Settings,
    room_id: str,
    player_message: str,
    *,
    npc_id: str = "npc-1",
    player_id: str = "__legacy__",
    timeout: float | None = None,
    attempts: int = 3,
) -> dict[str, Any]:
    res = _get_with_retry(
        client,
        f"{settings.game_server_url}/internal/rooms/{room_id}/memory-context",
        params={"playerMessage": player_message, "npcId": npc_id, "playerId": player_id},
        headers=_game_headers(settings),
        timeout=timeout if timeout is not None else _MEMORY_CONTEXT_TIMEOUT_S,
        attempts=attempts,
    )
    return res.json()


def parse_collective_from_context(ctx: dict[str, Any]) -> dict[str, Any]:
    """Extract collective attitude fields from memory-context JSON."""
    from src.collective.scoring import allowed_tools_for_band

    collective = ctx.get("collective") or {}
    band = collective.get("band") or "neutral"
    allowed = collective.get("allowedTools")
    if not isinstance(allowed, list) or not allowed:
        allowed = allowed_tools_for_band(band)
    summaries = collective.get("recentSummaries")
    effective = collective.get("effectiveScore")
    return {
        "attitude_band": band,
        "effective_score": int(effective) if isinstance(effective, (int, float)) else None,
        "allowed_tools": [str(t) for t in allowed],
        "collective_summaries": [str(s) for s in summaries] if isinstance(summaries, list) else [],
    }


def fetch_recent_memories(
    client: httpx.Client,
    settings: Settings,
    room_id: str,
    *,
    limit: int = 5,
    npc_id: str = "npc-1",
    player_id: str = "__legacy__",
) -> list[dict[str, Any]]:
    res = client.get(
        f"{settings.game_server_url}/internal/rooms/{room_id}/recent-memories",
        params={"limit": limit, "npcId": npc_id, "playerId": player_id},
        headers=_game_headers(settings),
        timeout=30.0,
    )
    res.raise_for_status()
    body = res.json()
    rows = body.get("memories")
    return rows if isinstance(rows, list) else []


def fetch_oldest_memories(
    client: httpx.Client,
    settings: Settings,
    room_id: str,
    *,
    limit: int = 50,
    npc_id: str = "npc-1",
    player_id: str = "__legacy__",
) -> list[dict[str, Any]]:
    res = client.get(
        f"{settings.game_server_url}/internal/rooms/{room_id}/oldest-memories",
        params={"limit": limit, "npcId": npc_id, "playerId": player_id},
        headers=_game_headers(settings),
        timeout=30.0,
    )
    res.raise_for_status()
    body = res.json()
    rows = body.get("memories")
    return rows if isinstance(rows, list) else []


def append_npc_memory(
    client: httpx.Client,
    settings: Settings,
    room_id: str,
    text: str,
    *,
    npc_id: str = "npc-1",
    player_id: str = "__legacy__",
    importance: int | None = None,
) -> None:
    body: dict[str, Any] = {"text": text, "role": "npc", "npcId": npc_id, "playerId": player_id}
    if importance is not None:
        body["importance"] = importance
    res = client.post(
        f"{settings.game_server_url}/internal/rooms/{room_id}/memories",
        json=body,
        headers=_game_headers(settings),
        timeout=30.0,
    )
    res.raise_for_status()


def append_player_memory(
    client: httpx.Client,
    settings: Settings,
    room_id: str,
    text: str,
    *,
    npc_id: str = "npc-1",
    player_id: str = "__legacy__",
    importance: int | None = None,
) -> None:
    body: dict[str, Any] = {
        "text": text,
        "role": "player",
        "npcId": npc_id,
        "playerId": player_id,
    }
    if importance is not None:
        body["importance"] = importance
    res = client.post(
        f"{settings.game_server_url}/internal/rooms/{room_id}/memories",
        json=body,
        headers=_game_headers(settings),
        timeout=30.0,
    )
    res.raise_for_status()


def store_reflection(
    client: httpx.Client,
    settings: Settings,
    room_id: str,
    text: str,
    *,
    npc_id: str = "npc-1",
    player_id: str = "__legacy__",
) -> None:
    res = client.post(
        f"{settings.game_server_url}/internal/rooms/{room_id}/reflect",
        json={"text": text, "npcId": npc_id, "playerId": player_id},
        headers=_game_headers(settings),
        timeout=30.0,
    )
    res.raise_for_status()


def store_bulk_summary(
    client: httpx.Client,
    settings: Settings,
    room_id: str,
    text: str,
    mark_ids: list[str],
    *,
    npc_id: str = "npc-1",
    player_id: str = "__legacy__",
    source_count: int | None = None,
) -> None:
    res = client.post(
        f"{settings.game_server_url}/internal/rooms/{room_id}/summarize-bulk",
        json={
            "text": text,
            "npcId": npc_id,
            "playerId": player_id,
            "markIds": mark_ids,
            "sourceCount": source_count or len(mark_ids),
        },
        headers=_game_headers(settings),
        timeout=60.0,
    )
    res.raise_for_status()
