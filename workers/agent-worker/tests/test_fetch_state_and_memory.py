from unittest.mock import MagicMock, patch

import httpx
import pytest

from src.config import Settings
from src.graph.npc_loop import fetch_state_and_memory


@pytest.fixture(autouse=True)
def _clear_worker_snapshot_cache():
    from src.graph import npc_loop

    npc_loop._stale_worker_snapshots.clear()
    yield
    npc_loop._stale_worker_snapshots.clear()


def test_physical_action_skips_full_memory_but_loads_collective_gate():
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
            with patch(
                "src.graph.npc_loop.fetch_memory_context",
                return_value={
                    "collective": {
                        "band": "hostile",
                        "effectiveScore": -40,
                        "allowedTools": ["speak", "wait"],
                    }
                },
            ) as fetch_ctx:
                out = fetch_state_and_memory(state, settings=settings, client=client)

    load_memory.assert_not_called()
    fetch_ctx.assert_called_once()
    _, kwargs = fetch_ctx.call_args
    assert kwargs.get("skip_embed") is True
    assert out["room_snapshot"]["npcs"][1]["y"] == 21
    assert out["attitude_band"] == "hostile"
    assert out["allowed_tools"] == ["speak", "wait"]
    assert "move" not in out["allowed_tools"]


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


def test_narrative_action_loads_memory_with_skip_embed():
    state = {
        "room_id": "default",
        "player_message": "故宫在哪里，给我讲讲历史",
        "npc_id": "npc-1",
        "player_id": "p1",
    }
    settings = Settings(game_server_url="http://127.0.0.1:2567")

    with patch("src.graph.npc_loop.fetch_state") as fetch_state:
        with patch("src.graph.npc_loop.fetch_nearby_lore_into_snapshot") as lazy_lore:
            with patch("src.graph.npc_loop.load_memory_context") as load_memory:
                fetch_state.return_value = {**state, "room_snapshot": {"npcs": []}}
                lazy_lore.side_effect = lambda s, **_: {
                    **s,
                    "room_snapshot": {"npcs": [], "nearbyLore": [{"cx": 0, "cy": 0}]},
                }
                load_memory.return_value = {
                    **state,
                    "memory_summary": "recall",
                    "memory_count": 3,
                    "attitude_band": "warm",
                }
                out = fetch_state_and_memory(state, settings=settings, client=MagicMock())

    load_memory.assert_called_once()
    _, kwargs = load_memory.call_args
    assert kwargs.get("skip_embed") is True
    fetch_state.assert_called_once()
    _, fetch_kwargs = fetch_state.call_args
    assert fetch_kwargs.get("skip_nearby_lore") is True
    lazy_lore.assert_called_once()
    assert out["memory_summary"] == "recall"
    assert out["memory_count"] == 3


def test_recall_action_loads_memory_with_full_embed():
    state = {
        "room_id": "default",
        "player_message": "你还记得密码吗",
        "npc_id": "npc-1",
        "player_id": "p1",
    }
    settings = Settings(game_server_url="http://127.0.0.1:2567")

    with patch("src.graph.npc_loop.fetch_state") as fetch_state:
        with patch("src.graph.npc_loop.load_memory_context") as load_memory:
            fetch_state.return_value = {**state, "room_snapshot": {"npcs": []}}
            load_memory.return_value = {**state, "memory_count": 1, "attitude_band": "neutral"}
            fetch_state_and_memory(state, settings=settings, client=MagicMock())

    _, kwargs = load_memory.call_args
    assert kwargs.get("skip_embed") is False
    assert kwargs.get("memory_timeout") == 18.0
    assert kwargs.get("memory_attempts") == 2


def test_fetch_state_uses_stale_snapshot_after_timeout():
    from src.graph import npc_loop

    settings = Settings(game_server_url="http://127.0.0.1:2567")
    state = {"room_id": "default", "player_id": "p1", "room_snapshot": {}}
    stale_body = {"npcs": [{"id": "npc-1", "x": 1, "y": 2}]}
    npc_loop._remember_worker_snapshot("default", "p1", stale_body)
    key = npc_loop._worker_state_stale_key("default", "p1")
    snap, ts = npc_loop._stale_worker_snapshots[key]
    npc_loop._stale_worker_snapshots[key] = (snap, ts - npc_loop._FETCH_STATE_HOT_CACHE_TTL_S - 1.0)

    with patch("src.graph.npc_loop.httpx.Client") as client_cls:
        client = MagicMock()
        client.__enter__ = MagicMock(return_value=client)
        client.__exit__ = MagicMock(return_value=False)
        client.get.side_effect = httpx.TimeoutException("timeout")
        client_cls.return_value = client

        out = npc_loop.fetch_state(state, settings=settings, client=client, skip_nearby_lore=True)

    assert out["room_snapshot"]["npcs"][0]["x"] == 1
    assert out["room_snapshot"].get("_stale") is True


def test_fetch_state_hot_cache_skips_http():
    from src.graph import npc_loop

    settings = Settings(game_server_url="http://127.0.0.1:2567")
    state = {"room_id": "default", "player_id": "p1", "room_snapshot": {}}
    fresh_body = {"npcs": [{"id": "npc-1", "x": 1, "y": 2}]}
    npc_loop._remember_worker_snapshot("default", "p1", fresh_body)

    with patch("src.graph.npc_loop.httpx.Client") as client_cls:
        client = MagicMock()
        client.__enter__ = MagicMock(return_value=client)
        client.__exit__ = MagicMock(return_value=False)
        client_cls.return_value = client

        with patch("src.graph.npc_loop.record_phase_ms") as record_phase:
            out = npc_loop.fetch_state(
                state,
                settings=settings,
                client=client,
                skip_nearby_lore=True,
            )

    client.get.assert_not_called()
    assert out["room_snapshot"]["npcs"][0]["x"] == 1
    record_phase.assert_any_call("t_fetch_state_ms", 0)
