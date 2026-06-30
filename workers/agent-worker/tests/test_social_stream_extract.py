"""Social JSON streaming — reply-first partial extraction (Step 2)."""

from src.collective.schemas import SOCIAL_SKIP_KIND, SocialPerception, SocialTurnOut
from src.config import Settings
from src.graph.job_context import reset_job_context, set_job_context
from src.graph.nodes.llm_social_turn import (
    _extract_reply_from_json_stream,
    _parse_social_turn_json,
    run_social_turn_llm,
)
from src.graph.state import GraphState


def test_extract_reply_from_reply_first_stream():
    buffer = '{"reply":"你好呀，需要我做什么？","social":{"kind":"ignore","summary":"","delta":0}}'
    assert _extract_reply_from_json_stream(buffer) == "你好呀，需要我做什么？"


def test_extract_reply_from_social_first_stream_empty_until_reply():
    social_first = '{"social":{"kind":"ignore","summary":"","delta":0},"reply":"'
    assert _extract_reply_from_json_stream(social_first) == ""


def test_extract_reply_incremental_reply_first():
    partial = '{"reply":"你'
    assert _extract_reply_from_json_stream(partial) == "你"
    partial += '好","social":{"kind":"ignore"'
    assert _extract_reply_from_json_stream(partial) == "你好"


def test_parse_social_turn_json_reply_first():
    raw = '{"reply":"嗯，我在听。","social":{"kind":"ignore","summary":"","delta":0}}'
    parsed = _parse_social_turn_json(raw)
    assert parsed is not None
    assert parsed.reply == "嗯，我在听。"
    assert parsed.social.kind == SOCIAL_SKIP_KIND


def test_run_social_turn_llm_emits_partial_on_reply_first_stream(monkeypatch):
    monkeypatch.delenv("LLM_MOCK", raising=False)
    partials: list[str] = []

    class _Chunk:
        def __init__(self, content: str):
            self.content = content

    class _LLM:
        def stream(self, _messages):
            chunks = [
                '{"reply":"你',
                '好呀","social":{"kind":"ignore","summary":"","delta":0}}',
            ]
            for piece in chunks:
                yield _Chunk(piece)

    monkeypatch.setattr(
        "src.graph.nodes.llm_social_turn.create_chat_model",
        lambda **_kwargs: _LLM(),
    )
    monkeypatch.setattr(
        "src.graph.nodes.llm_social_turn.auxiliary_provider_attempts",
        lambda _cfg, **_: [("nvidia", "meta/llama-3.3-70b-instruct")],
    )

    tokens = set_job_context(partial_emit=partials.append, phase_timing={})
    try:
        state: GraphState = {
            "room_id": "default",
            "player_message": "你好",
            "npc_id": "npc-1",
            "player_id": "p1",
            "room_snapshot": {"width": 8, "height": 8, "npcs": []},
        }
        turn = run_social_turn_llm(state, settings=Settings(llm_mock=False))
    finally:
        reset_job_context(tokens)

    assert turn.reply == "你好呀"
    assert partials
    assert partials[0] == "你"
    assert partials[-1] == "你好呀"


def test_run_social_turn_llm_salvages_truncated_stream_reply(monkeypatch):
    """When JSON is truncated (max_tokens), keep the streamed reply instead of generic fallback."""
    monkeypatch.delenv("LLM_MOCK", raising=False)
    partials: list[str] = []

    class _Chunk:
        def __init__(self, content: str):
            self.content = content

    truncated = (
        '{"reply":"这份心意我收下了，但请收回这份","social":{"kind":"affection","summary":"玩家表白'
    )

    class _LLM:
        def stream(self, _messages):
            yield _Chunk(truncated)

    monkeypatch.setattr(
        "src.graph.nodes.llm_social_turn.create_chat_model",
        lambda **_kwargs: _LLM(),
    )
    monkeypatch.setattr(
        "src.graph.nodes.llm_social_turn.auxiliary_provider_attempts",
        lambda _cfg, **_: [("agnes", "agnes-2.0-flash")],
    )

    tokens = set_job_context(partial_emit=partials.append, phase_timing={})
    try:
        state: GraphState = {
            "room_id": "default",
            "player_message": "我喜欢你～",
            "npc_id": "npc-11",
            "player_id": "p1",
            "room_snapshot": {"width": 8, "height": 8, "npcs": []},
        }
        turn = run_social_turn_llm(state, settings=Settings(llm_mock=False))
    finally:
        reset_job_context(tokens)

    assert turn.reply == "这份心意我收下了，但请收回这份"
    assert "我听到了" not in turn.reply
    assert partials[-1] == turn.reply


def test_run_social_turn_llm_skips_partial_stream_on_recall_question(monkeypatch):
    monkeypatch.delenv("LLM_MOCK", raising=False)
    partials: list[str] = []

    class _Chunk:
        def __init__(self, content: str):
            self.content = content

    class _LLM:
        def stream(self, _messages):
            raise AssertionError("recall should use invoke, not stream")

        def invoke(self, _messages):
            class _Resp:
                content = (
                    '{"reply":"电脑密码是 111。","social":{"kind":"ignore","summary":"","delta":0}}'
                )

            return _Resp()

    monkeypatch.setattr(
        "src.graph.nodes.llm_social_turn.create_chat_model",
        lambda **_kwargs: _LLM(),
    )
    monkeypatch.setattr(
        "src.graph.nodes.llm_social_turn.auxiliary_provider_attempts",
        lambda _cfg, **_: [("nvidia", "meta/llama-3.3-70b-instruct")],
    )

    tokens = set_job_context(partial_emit=partials.append, phase_timing={})
    try:
        state: GraphState = {
            "room_id": "default",
            "player_message": "还记得我家电脑密码吗？",
            "npc_id": "npc-3",
            "player_id": "p1",
            "room_snapshot": {"width": 8, "height": 8, "npcs": []},
        }
        turn = run_social_turn_llm(state, settings=Settings(llm_mock=False))
    finally:
        reset_job_context(tokens)

    assert "111" in turn.reply
    assert partials == []
