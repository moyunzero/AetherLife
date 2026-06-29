from unittest.mock import MagicMock, patch

from src.collective.schemas import SOCIAL_SKIP_KIND, SocialPerception, SocialTurnOut
from src.config import Settings
from src.graph.casual_fast_lane import run_casual_fast_lane
from src.graph.speak_intent import can_use_casual_fast_lane


def _preview_for(message: str) -> SocialTurnOut:
    _, turn = can_use_casual_fast_lane(message)
    assert turn is not None
    return turn


def test_run_casual_fast_lane_returns_reply():
    message = "你好，用一句话简短回复"
    preview = _preview_for(message)
    settings = Settings(game_server_url="http://127.0.0.1:2567")

    fake_response = MagicMock()
    fake_response.raise_for_status = MagicMock()
    fake_response.json.return_value = {
        "state": {
            "roomId": "default",
            "npcs": [{"id": "npc-1", "name": "莫玄虚", "x": 1, "y": 2}],
            "objects": [],
        },
    }

    with patch("src.graph.casual_fast_lane.httpx.Client") as client_cls:
        client = MagicMock()
        client.__enter__ = MagicMock(return_value=client)
        client.__exit__ = MagicMock(return_value=False)
        client.get.return_value = fake_response
        client_cls.return_value = client

        with patch("src.graph.job_context.record_phase_ms"):
            out = run_casual_fast_lane(
                room_id="default",
                player_message=message,
                npc_id="npc-1",
                player_id="p1",
                recent_turns=[],
                preview=preview,
                settings=settings,
            )

    assert out["speak_intent"] == "casual"
    assert out["reply"] == preview.reply
    assert out["room_snapshot"]["npcs"][0]["name"] == "莫玄虚"
    assert out["memory_count"] == 0


def test_run_casual_fast_lane_no_checkpointer():
    message = "你好"
    preview = SocialTurnOut(
        social=SocialPerception(kind=SOCIAL_SKIP_KIND, summary="", delta=0),
        reply="你好呀，需要我做什么？",
    )
    settings = Settings(game_server_url="http://127.0.0.1:2567")

    with patch("src.graph.casual_fast_lane.fetch_state") as fetch_state:
        fetch_state.return_value = {
            "room_id": "default",
            "room_snapshot": {"npcs": []},
        }
        with patch("src.graph.casual_fast_lane.apply_tools") as apply_tools:
            apply_tools.side_effect = lambda s, **_: s
            with patch("src.graph.job_context.record_phase_ms"):
                with patch("src.graph.npc_loop.get_checkpointer") as get_cp:
                    run_casual_fast_lane(
                        room_id="default",
                        player_message=message,
                        npc_id="npc-1",
                        player_id="p1",
                        recent_turns=[],
                        preview=preview,
                        settings=settings,
                    )
    get_cp.assert_not_called()


def test_run_casual_fast_lane_short_circuits_zero_side_effect():
    message = "你好，用一句话简短回复"
    preview = _preview_for(message)
    settings = Settings(game_server_url="http://127.0.0.1:2567")

    with patch("src.graph.casual_fast_lane.fetch_state") as fetch_state:
        fetch_state.return_value = {
            "room_id": "default",
            "room_snapshot": {"npcs": []},
        }
        with patch("src.graph.casual_fast_lane.apply_social_event") as apply_social:
            with patch("src.graph.casual_fast_lane.apply_tools") as apply_tools:
                with patch("src.graph.job_context.record_phase_ms"):
                    out = run_casual_fast_lane(
                        room_id="default",
                        player_message=message,
                        npc_id="npc-1",
                        player_id="p1",
                        recent_turns=[],
                        preview=preview,
                        settings=settings,
                    )
    apply_social.assert_not_called()
    apply_tools.assert_not_called()
    assert out["reply"] == preview.reply
