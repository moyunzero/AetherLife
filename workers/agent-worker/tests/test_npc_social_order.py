import os

import httpx
import pytest

from src.config import Settings
from src.graph.npc_loop import run_npc_turn_interactive
from src.persistence.checkpointer import reset_checkpointer_for_tests


@pytest.fixture(autouse=True)
def _mock_env(monkeypatch):
    monkeypatch.setenv("LLM_MOCK", "1")
    reset_checkpointer_for_tests()


def _fake_client_factory():
    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {
                "state": {
                    "roomId": "default",
                    "width": 8,
                    "height": 8,
                    "npcs": [{"id": "npc-1", "name": "路昂", "x": 2, "y": 2, "inventory": []}],
                    "objects": [],
                },
                "collective": {
                    "band": "neutral",
                    "effectiveScore": -5,
                    "allowedTools": ["speak", "wait", "move", "interact", "transfer"],
                    "recentSummaries": [],
                },
            }

    class FakeClient:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def get(self, url, *args, **kwargs):
            if "memory-context" in url:
                return type(
                    "R",
                    (),
                    {
                        "raise_for_status": lambda self: None,
                        "json": lambda self: {
                            "ok": True,
                            "memoryCount": 0,
                            "retrieved": [],
                            "collective": {
                                "band": "neutral",
                                "effectiveScore": -5,
                                "allowedTools": ["speak", "wait", "move", "interact", "transfer"],
                                "recentSummaries": [],
                            },
                        },
                    },
                )()
            return FakeResponse()

        def post(self, *args, **kwargs):
            body = kwargs.get("json") or {}
            if body.get("actions"):
                return type(
                    "R",
                    (),
                    {
                        "status_code": 200,
                        "raise_for_status": lambda self: None,
                        "json": lambda self: {
                            "state": {
                                "npcs": [{"id": "npc-1", "x": 2, "y": 2, "inventory": []}],
                                "objects": [],
                                "width": 8,
                                "height": 8,
                            },
                            "applied": len(body.get("actions") or []),
                        },
                    },
                )()
            return type(
                "R",
                (),
                {
                    "status_code": 200,
                    "raise_for_status": lambda self: None,
                    "json": lambda self: {"ok": True},
                },
            )()

    return FakeClient


def test_insult_applies_social_before_reply(monkeypatch):
    monkeypatch.setattr(httpx, "Client", _fake_client_factory())
    settings = Settings(llm_mock=True, game_server_url="http://127.0.0.1:2567")

    result = run_npc_turn_interactive(
        room_id="room-social",
        player_message="你好丑啊",
        npc_id="npc-1",
        player_id="player-a",
        settings=settings,
    )

    assert result.get("social_applied") is True
    assert result.get("collective_updated") is True
    assert result.get("effective_score") is not None
    assert result["effective_score"] < -5
    assert result.get("reply")
    assert "请不要" in result["reply"] or len(result["reply"]) > 0


def test_neutral_skips_social_write(monkeypatch):
    monkeypatch.setattr(httpx, "Client", _fake_client_factory())
    settings = Settings(llm_mock=True, game_server_url="http://127.0.0.1:2567")

    result = run_npc_turn_interactive(
        room_id="room-neutral",
        player_message="今天天气不错",
        npc_id="npc-1",
        player_id="player-a",
        settings=settings,
    )

    assert result.get("social_applied") is not True
    assert result.get("reply")
