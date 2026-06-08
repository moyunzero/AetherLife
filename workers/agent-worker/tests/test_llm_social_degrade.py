from src.collective.schemas import SOCIAL_SKIP_KIND, SocialPerception, SocialTurnOut
from src.config import Settings
from src.graph.nodes.llm_social_turn import llm_social_turn, run_social_turn_llm
from src.graph.state import GraphState


def test_run_social_turn_llm_degrades_on_timeout(monkeypatch):
    def _timeout(*_args, **_kwargs):
        raise TimeoutError("Request timed out")

    monkeypatch.setattr(
        "src.graph.nodes.llm_social_turn.create_chat_model",
        lambda **_kwargs: type("LLM", (), {"invoke": _timeout})(),
    )
    monkeypatch.setattr(
        "src.graph.nodes.llm_social_turn.auxiliary_provider_attempts",
        lambda _cfg, **_: [("siliconflow", "Qwen/Qwen3.5-4B")],
    )

    state: GraphState = {
        "room_id": "default",
        "player_message": "hello",
        "npc_id": "npc-1",
        "player_id": "p1",
    }
    turn = run_social_turn_llm(state, settings=Settings(llm_mock=False))
    assert turn.social.kind == "ignore"
    assert "hello" in turn.reply


def test_run_social_turn_llm_parse_fail_tries_next_provider_once(monkeypatch):
    monkeypatch.delenv("LLM_MOCK", raising=False)
    calls: list[str] = []

    class _LLM:
        def __init__(self, tag: str):
            self._tag = tag

        def invoke(self, _messages):
            calls.append(self._tag)
            return type("R", (), {"content": "not-json"})()

    def _create(**kwargs):
        provider = kwargs.get("provider", "")
        return _LLM(str(provider))

    monkeypatch.setattr(
        "src.graph.nodes.llm_social_turn.create_chat_model",
        _create,
    )
    monkeypatch.setattr(
        "src.graph.nodes.llm_social_turn.auxiliary_provider_attempts",
        lambda _cfg, **_: [("siliconflow", "fast"), ("agnes", "agnes-2.0-flash")],
    )

    state: GraphState = {
        "room_id": "default",
        "player_message": "hello",
        "npc_id": "npc-1",
        "player_id": "p1",
    }
    turn = run_social_turn_llm(state, settings=Settings(llm_mock=False))
    assert calls == ["siliconflow", "agnes"]
    assert turn.social.kind == "ignore"


def test_llm_social_turn_skips_tool_llm_for_relative_move(monkeypatch):
    state: GraphState = {
        "room_id": "default",
        "player_message": "移动到我的下方",
        "npc_id": "npc-1",
        "player_id": "p1",
        "room_snapshot": {
            "width": 8,
            "height": 8,
            "player": {"x": 3, "y": 3},
            "players": {"p1": {"x": 3, "y": 3}},
            "npcs": [{"id": "npc-1", "x": 2, "y": 2}],
        },
        "allowed_tools": ["move", "wait", "speak", "interact", "transfer"],
    }

    monkeypatch.setattr(
        "src.graph.nodes.llm_social_turn.run_social_turn_llm",
        lambda *_a, **_k: SocialTurnOut(
            social=SocialPerception(kind=SOCIAL_SKIP_KIND, summary="", delta=0),
            reply="好的",
        ),
    )

    def _should_not_call(**_kwargs):
        raise AssertionError("tool LLM should not run for deterministic relative move")

    monkeypatch.setattr(
        "src.graph.nodes.llm_social_turn.create_chat_model",
        _should_not_call,
    )

    out = llm_social_turn(state, settings=Settings(llm_mock=False))
    assert out["tool_calls"]
    assert out["tool_calls"][0]["name"] == "move"
    assert out["tool_calls"][0]["args"]["y"] == 4


def test_llm_social_turn_injects_move_when_tool_llm_fails(monkeypatch):
    state: GraphState = {
        "room_id": "default",
        "player_message": "移动到我的下方",
        "npc_id": "npc-1",
        "player_id": "p1",
        "room_snapshot": {
            "width": 8,
            "height": 8,
            "player": {"x": 3, "y": 3},
            "players": {"p1": {"x": 3, "y": 3}},
            "npcs": [{"id": "npc-1", "x": 2, "y": 2}],
        },
        "allowed_tools": ["move", "wait", "speak", "interact", "transfer"],
    }

    def _timeout(*_args, **_kwargs):
        raise TimeoutError("Request timed out")

    monkeypatch.setattr(
        "src.graph.nodes.llm_social_turn.run_social_turn_llm",
        lambda *_a, **_k: SocialTurnOut(
            social=SocialPerception(kind=SOCIAL_SKIP_KIND, summary="", delta=0),
            reply="好的",
        ),
    )
    monkeypatch.setattr(
        "src.graph.nodes.llm_social_turn.create_chat_model",
        lambda **_kwargs: type("LLM", (), {"bind_tools": lambda self, _t: self, "invoke": _timeout})(),
    )
    monkeypatch.setattr(
        "src.graph.nodes.llm_social_turn.npc_provider_attempts",
        lambda _cfg: [("siliconflow", "Qwen/Qwen3.5-4B")],
    )

    out = llm_social_turn(state, settings=Settings(llm_mock=False))
    assert out["tool_calls"]
    assert out["tool_calls"][0]["name"] == "move"
