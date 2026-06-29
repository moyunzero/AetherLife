import os

from src.config import Settings
from src.graph.npc_loop import build_npc_graph, build_npc_interactive_graph, run_npc_turn
from src.persistence.checkpointer import reset_checkpointer_for_tests


def test_build_npc_graph_compiles():
    reset_checkpointer_for_tests()
    graph = build_npc_graph(Settings(llm_mock=True))
    assert graph is not None


def test_build_npc_interactive_graph_compiles():
    reset_checkpointer_for_tests()
    graph = build_npc_interactive_graph(Settings(llm_mock=True))
    assert graph is not None


def test_mock_turn_returns_move_tool_call(monkeypatch):
    monkeypatch.setenv("LLM_MOCK", "1")
    reset_checkpointer_for_tests()
    settings = Settings(llm_mock=True, game_server_url="http://127.0.0.1:2567")

    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {
                "state": {
                    "roomId": "default",
                    "width": 8,
                    "height": 8,
                    "npcs": [{"id": "npc-1", "name": "莫玄虚", "x": 2, "y": 2, "inventory": []}],
                    "objects": [{"id": "door-1", "state": "closed"}],
                }
            }

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

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
                            "memoryCount": 1,
                            "retrieved": [],
                            "latestBulkSummary": None,
                            "latestReflection": None,
                        },
                    },
                )()
            if "recent-memories" in url or "oldest-memories" in url:
                return type(
                    "R",
                    (),
                    {
                        "raise_for_status": lambda self: None,
                        "json": lambda self: {"ok": True, "memories": []},
                    },
                )()
            return FakeResponse()

        def post(self, *args, **kwargs):
            body = kwargs.get("json") or {}
            if body.get("text") and not body.get("actions"):
                return type(
                    "R",
                    (),
                    {
                        "status_code": 200,
                        "raise_for_status": lambda self: None,
                        "json": lambda self: {"ok": True},
                    },
                )()
            actions = body.get("actions") or []
            acting = body.get("actingNpcId", "npc-1")
            npcs = [
                {
                    "id": acting,
                    "name": "莫玄虚",
                    "x": 2,
                    "y": 2,
                    "inventory": [],
                }
            ]
            if actions and actions[0].get("type") == "move":
                npcs[0]["x"] = actions[0]["x"]
                npcs[0]["y"] = actions[0]["y"]
            return type(
                "R",
                (),
                {
                    "status_code": 200,
                    "raise_for_status": lambda self: None,
                    "json": lambda self: {
                        "state": {"npcs": npcs, "objects": [], "width": 8, "height": 8},
                        "applied": len(actions),
                    },
                },
            )()

    import httpx

    monkeypatch.setattr(httpx, "Client", FakeClient)

    result = run_npc_turn(
        room_id="default",
        player_message="go to 4,5",
        npc_id="npc-2",
        settings=settings,
    )
    assert result.get("tool_calls")
    assert result["tool_calls"][0]["name"] == "move"


def test_run_npc_turn_uses_per_npc_thread_id(monkeypatch):
    reset_checkpointer_for_tests()
    captured: dict = {}

    class FakeGraph:
        def invoke(self, initial, config=None):
            captured["config"] = config
            return {**initial, "tool_calls": [], "reply": "ok"}

    monkeypatch.setattr("src.graph.npc_loop.build_npc_interactive_graph", lambda _cfg: FakeGraph())
    settings = Settings(llm_mock=True, game_server_url="http://127.0.0.1:2567")

    from src.graph.npc_loop import run_npc_turn_interactive

    run_npc_turn_interactive(
        room_id="room-a",
        player_message="hi",
        npc_id="npc-2",
        settings=settings,
    )

    assert (
        captured["config"]["configurable"]["thread_id"]
        == "room:room-a:player:__legacy__:npc:npc-2"
    )
