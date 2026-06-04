from typing import Any

import httpx

from src.config import Settings


def _game_headers(settings: Settings) -> dict[str, str]:
    headers: dict[str, str] = {}
    if settings.internal_worker_token:
        headers["Authorization"] = f"Bearer {settings.internal_worker_token}"
    return headers


def fetch_memory_context(
    client: httpx.Client,
    settings: Settings,
    room_id: str,
    player_message: str,
    npc_id: str = "npc-1",
) -> dict[str, Any]:
    res = client.get(
        f"{settings.game_server_url}/internal/rooms/{room_id}/memory-context",
        params={"playerMessage": player_message, "npcId": npc_id},
        headers=_game_headers(settings),
        timeout=30.0,
    )
    res.raise_for_status()
    return res.json()


def fetch_recent_memories(
    client: httpx.Client,
    settings: Settings,
    room_id: str,
    *,
    limit: int = 5,
    npc_id: str = "npc-1",
) -> list[dict[str, Any]]:
    res = client.get(
        f"{settings.game_server_url}/internal/rooms/{room_id}/recent-memories",
        params={"limit": limit, "npcId": npc_id},
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
) -> list[dict[str, Any]]:
    res = client.get(
        f"{settings.game_server_url}/internal/rooms/{room_id}/oldest-memories",
        params={"limit": limit, "npcId": npc_id},
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
    importance: int | None = None,
) -> None:
    body: dict[str, Any] = {"text": text, "role": "npc", "npcId": npc_id}
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
) -> None:
    res = client.post(
        f"{settings.game_server_url}/internal/rooms/{room_id}/reflect",
        json={"text": text, "npcId": npc_id},
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
    source_count: int | None = None,
) -> None:
    res = client.post(
        f"{settings.game_server_url}/internal/rooms/{room_id}/summarize-bulk",
        json={
            "text": text,
            "npcId": npc_id,
            "markIds": mark_ids,
            "sourceCount": source_count or len(mark_ids),
        },
        headers=_game_headers(settings),
        timeout=60.0,
    )
    res.raise_for_status()
