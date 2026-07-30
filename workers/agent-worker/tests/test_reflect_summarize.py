import json

from src.config import Settings
from src.graph.reflect import (
    NPC_MOODS,
    _parse_reflect_json,
    run_reflect_llm,
    run_reflect_llm_structured,
    should_reflect,
)
from src.graph.summarize import maybe_bulk_summarize, run_bulk_summarize_llm


def test_should_reflect_every_n():
    assert should_reflect(5, 5)
    assert should_reflect(10, 5)
    assert not should_reflect(4, 5)
    assert not should_reflect(0, 5)


def test_bulk_summarize_mock_llm():
    text = run_bulk_summarize_llm(["a", "b", "c"], Settings(llm_mock=True))
    assert "3 memories" in text


def test_maybe_bulk_summarize_skips_below_threshold(monkeypatch):
    settings = Settings(llm_mock=True, summarize_threshold=100)
    client = __import__("unittest.mock").mock.MagicMock()
    assert maybe_bulk_summarize(client, settings, "default", 50) is False
    client.get.assert_not_called()


def test_run_reflect_llm_structured_mock_returns_chinese_mood():
    out = run_reflect_llm_structured(["player: 你好", "npc: 嗯"], Settings(llm_mock=True))
    assert out is not None
    assert out.text
    assert out.mood in NPC_MOODS
    assert out.beliefs is not None
    assert len(out.beliefs) >= 1
    assert any("我" in b for b in out.beliefs)


def test_run_reflect_llm_wrapper_returns_prose_str():
    text = run_reflect_llm(["a", "b"], Settings(llm_mock=True))
    assert isinstance(text, str)
    assert "Recent events" in text


def test_parse_reflect_json_bad_omits_semantic():
    assert _parse_reflect_json("not json at all") is None
    assert _parse_reflect_json("{broken") is None


def test_parse_reflect_json_valid_with_optional_summary():
    payload = {
        "text": "最近对方态度缓和。",
        "mood": "亲近",
        "beliefs": ["我愿意再给他一次机会"],
        "summary": "关系略有回暖",
    }
    out = _parse_reflect_json(json.dumps(payload, ensure_ascii=False))
    assert out is not None
    assert out.text == "最近对方态度缓和。"
    assert out.mood == "亲近"
    assert out.beliefs == ["我愿意再给他一次机会"]
    assert out.summary == "关系略有回暖"


def test_parse_reflect_json_illegal_mood_omits_mood():
    payload = {
        "text": "有事发生。",
        "mood": "angry",
        "beliefs": ["我不信他的承诺"],
    }
    out = _parse_reflect_json(json.dumps(payload, ensure_ascii=False))
    assert out is not None
    assert out.text == "有事发生。"
    assert out.mood is None
    assert out.beliefs == ["我不信他的承诺"]
