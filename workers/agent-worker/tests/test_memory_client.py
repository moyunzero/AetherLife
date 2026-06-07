import httpx

from src.config import Settings
from src.memory.client import append_npc_memory, append_player_memory, fetch_memory_context


def test_fetch_memory_context_retries_transient_502():
    settings = Settings(game_server_url="http://test")
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] == 1:
            return httpx.Response(502, json={"ok": False, "error": "bad gateway"})
        return httpx.Response(
            200,
            json={
                "ok": True,
                "memoryCount": 1,
                "retrieved": [],
                "latestBulkSummary": None,
                "latestReflection": None,
            },
        )

    transport = httpx.MockTransport(handler)
    with httpx.Client(transport=transport) as client:
        ctx = fetch_memory_context(client, settings, "default", "hello")
    assert ctx["memoryCount"] == 1
    assert calls["n"] == 2


def test_fetch_memory_context_parses_reflection(monkeypatch):
    settings = Settings(game_server_url="http://test")

    def handler(request: httpx.Request) -> httpx.Response:
        assert "/memory-context" in str(request.url)
        assert "npcId=npc-1" in str(request.url)
        return httpx.Response(
            200,
            json={
                "ok": True,
                "memoryCount": 3,
                "retrieved": [{"text": "player: hi", "score": 0.8, "importance": 5}],
                "latestBulkSummary": "bulk text",
                "latestReflection": "reflect text",
            },
        )

    transport = httpx.MockTransport(handler)
    with httpx.Client(transport=transport) as client:
        ctx = fetch_memory_context(client, settings, "default", "hello")
    assert ctx["latestReflection"] == "reflect text"
    assert ctx["latestBulkSummary"] == "bulk text"
    assert ctx["memoryCount"] == 3


def test_append_npc_memory_posts_importance(monkeypatch):
    settings = Settings(game_server_url="http://test")
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["path"] = str(request.url)
        captured["body"] = __import__("json").loads(request.content.decode())
        return httpx.Response(200, json={"ok": True})

    transport = httpx.MockTransport(handler)
    with httpx.Client(transport=transport) as client:
        append_npc_memory(client, settings, "default", "npc: hello", importance=7)

    assert "/memories" in captured["path"]
    assert captured["body"]["importance"] == 7


def test_append_player_memory_posts_role_player():
    settings = Settings(game_server_url="http://test")
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = __import__("json").loads(request.content.decode())
        return httpx.Response(200, json={"ok": True})

    transport = httpx.MockTransport(handler)
    with httpx.Client(transport=transport) as client:
        append_player_memory(
            client,
            settings,
            "default",
            "hello there",
            importance=6,
            player_id="player-abc",
        )

    assert captured["body"]["role"] == "player"
    assert captured["body"]["text"] == "hello there"
    assert captured["body"]["importance"] == 6
    assert captured["body"]["playerId"] == "player-abc"
