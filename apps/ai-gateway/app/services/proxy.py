from __future__ import annotations

import httpx

from app.config import get_settings


async def proxy_chat(room_id: str, message: str, npc_id: str) -> dict:
    settings = get_settings()
    url = f"{settings.game_server_url.rstrip('/')}/rooms/{room_id}/chat"
    headers: dict[str, str] = {"Content-Type": "application/json"}
    if settings.internal_worker_token:
        headers["Authorization"] = f"Bearer {settings.internal_worker_token}"
    async with httpx.AsyncClient(timeout=30.0) as client:
        res = await client.post(
            url,
            json={"message": message, "npcId": npc_id},
            headers=headers,
        )
        res.raise_for_status()
        return res.json()
