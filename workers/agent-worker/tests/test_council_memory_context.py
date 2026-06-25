import httpx

from src.config import Settings
from src.council.memory_context import COUNCIL_MEMORY_PLAYER_ID, fetch_council_memory_context


def test_fetch_council_memory_context_uses_council_player_id():
    settings = Settings(game_server_url="http://test")
    captured: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["playerId"] = request.headers.get("X-Player-Id", "")
        assert "/memory-context" in str(request.url)
        assert f"playerId={COUNCIL_MEMORY_PLAYER_ID}" in str(request.url)
        return httpx.Response(
            200,
            json={
                "ok": True,
                "memoryCount": 2,
                "retrieved": [{"text": "npc: council seed", "score": 0.9, "importance": 9}],
                "latestBulkSummary": None,
                "latestReflection": None,
            },
        )

    transport = httpx.MockTransport(handler)
    with httpx.Client(transport=transport) as client:
        ctx = fetch_council_memory_context(
            client,
            settings,
            "default",
            "debate topic",
            npc_id="npc-3",
        )

    assert captured["playerId"] == COUNCIL_MEMORY_PLAYER_ID
    assert ctx["memoryCount"] == 2
    assert ctx["retrieved"][0]["text"] == "npc: council seed"
