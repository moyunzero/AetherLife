from unittest.mock import MagicMock, patch

import httpx

from src.config import Settings
from src.graph.npc_loop import load_memory_context
from src.graph.recall_merge import pick_recall_memory


def test_load_memory_context_uses_recent_only_when_embed_misses_seed():
    state = {
        "room_id": "verify-p21-test",
        "player_message": "我之前说的 FACT-P21-ABC 门禁密码是多少？",
        "npc_id": "npc-1",
        "player_id": "verifyp211234567890",
        "recent_turns": [],
    }
    settings = Settings(game_server_url="http://127.0.0.1:2567")
    seed_row = {"text": "player: 请记住 FACT-P21-ABC 门禁密码是 7"}

    with patch(
        "src.graph.speak_fetch.fetch_memory_context",
        return_value={"memoryCount": 0, "retrieved": []},
    ):
        with patch(
            "src.graph.speak_fetch.fetch_recent_memories",
            return_value=[seed_row],
        ) as fetch_recent:
            client = MagicMock(spec=httpx.Client)
            out = load_memory_context(state, settings=settings, client=client)

    assert fetch_recent.call_count >= 1
    picked = pick_recall_memory(state["player_message"], out["retrieved_memories"])
    assert picked is not None
    assert "FACT-P21-ABC" in (picked.get("text") or "")


def test_recall_recent_only_miss_stderr_omits_memory_text(capsys):
    """Miss path must log counts only — never dump recalled memory contents."""
    secret = "player: 门锁密码是 SECRET-PASS-42"
    state = {
        "room_id": "verify-mem-privacy",
        "player_message": "我叫什么名字？",
        "npc_id": "npc-1",
        "player_id": "playerprivacy001",
        "recent_turns": [],
    }
    settings = Settings(game_server_url="http://127.0.0.1:2567")

    with patch(
        "src.graph.speak_fetch.fetch_memory_context",
        return_value={"memoryCount": 0, "retrieved": []},
    ):
        with patch(
            "src.graph.speak_fetch.fetch_recent_memories",
            return_value=[{"text": secret}],
        ):
            client = MagicMock(spec=httpx.Client)
            load_memory_context(state, settings=settings, client=client)

    err = capsys.readouterr().err
    assert "recent-only miss" in err
    assert "matched=false" in err
    assert "preview=" not in err
    assert "SECRET-PASS-42" not in err
    assert secret not in err
