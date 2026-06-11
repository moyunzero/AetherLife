from unittest.mock import MagicMock, patch

import httpx

from src.config import Settings
from src.graph.npc_loop import fetch_state_and_memory


def test_physical_action_skips_memory_context():
    state = {
        "room_id": "default",
        "player_message": "费雪找你，去她下方好吗？",
        "npc_id": "npc-1",
        "player_id": "p1",
    }
    settings = Settings(game_server_url="http://127.0.0.1:2567")

    fake_response = MagicMock()
    fake_response.raise_for_status = MagicMock()
    fake_response.json.return_value = {
        "state": {
            "roomId": "default",
            "npcs": [
                {"id": "npc-1", "name": "路昂", "x": 23, "y": 10},
                {"id": "npc-2", "name": "费雪", "x": 9, "y": 21},
            ],
            "objects": [],
        },
    }

    with patch("src.graph.npc_loop.httpx.Client") as client_cls:
        client = MagicMock()
        client.__enter__ = MagicMock(return_value=client)
        client.__exit__ = MagicMock(return_value=False)
        client.get.return_value = fake_response
        client_cls.return_value = client

        with patch("src.graph.npc_loop.load_memory_context") as load_memory:
            out = fetch_state_and_memory(state, settings=settings, client=client)

    load_memory.assert_not_called()
    assert out["room_snapshot"]["npcs"][1]["y"] == 21
    assert out["attitude_band"] == "neutral"
    assert "move" in out["allowed_tools"]


def test_casual_action_skips_memory_context():
    state = {
        "room_id": "default",
        "player_message": "你好",
        "npc_id": "npc-1",
        "player_id": "p1",
    }
    settings = Settings(game_server_url="http://127.0.0.1:2567")

    with patch("src.graph.npc_loop.fetch_state") as fetch_state:
        with patch("src.graph.npc_loop.load_memory_context") as load_memory:
            fetch_state.side_effect = lambda s, **_: {
                **s,
                "room_snapshot": {"npcs": []},
            }
            out = fetch_state_and_memory(state, settings=settings, client=MagicMock())

    load_memory.assert_not_called()
    fetch_state.assert_called_once()
    _, kwargs = fetch_state.call_args
    assert kwargs.get("skip_nearby_lore") is True
    assert out["speak_intent"] == "casual"
    assert out["attitude_band"] == "neutral"
    assert out["memory_count"] == 0


def test_narrative_action_loads_memory_with_full_embed():
    state = {
        "room_id": "default",
        "player_message": "故宫在哪里，给我讲讲历史",
        "npc_id": "npc-1",
        "player_id": "p1",
    }
    settings = Settings(game_server_url="http://127.0.0.1:2567")

    with patch("src.graph.npc_loop.fetch_state") as fetch_state:
        with patch("src.graph.npc_loop.load_memory_context") as load_memory:
            fetch_state.return_value = {**state, "room_snapshot": {"npcs": []}}
            load_memory.return_value = {
                **state,
                "memory_summary": "recall",
                "memory_count": 3,
                "attitude_band": "warm",
            }
            out = fetch_state_and_memory(state, settings=settings, client=MagicMock())

    load_memory.assert_called_once()
    _, kwargs = load_memory.call_args
    assert kwargs.get("skip_embed") is False
    assert out["memory_summary"] == "recall"
    assert out["memory_count"] == 3
