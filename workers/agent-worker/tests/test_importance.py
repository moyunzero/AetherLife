from src.config import Settings
from src.memory.importance import _parse_turn_importance, score_importance, score_turn_importance


def test_parse_turn_importance_json():
    parsed = _parse_turn_importance('{"player":3,"npc":8}')
    assert parsed == (3, 8)


def test_score_turn_importance_mock(monkeypatch):
    monkeypatch.setenv("LLM_MOCK", "1")
    assert score_turn_importance("move north", "ok") == (5, 5)


def test_score_turn_importance_timeout_fallback(monkeypatch):
    def _boom(*_args, **_kwargs):
        raise TimeoutError("Request timed out")

    monkeypatch.setattr("src.memory.importance._invoke_importance_llm", _boom)
    assert score_turn_importance("move north", "ok", settings=Settings()) == (5, 5)


def test_score_importance_connection_fallback(monkeypatch):
    def _boom(*_args, **_kwargs):
        raise ConnectionError("Connection timed out")

    monkeypatch.setattr("src.memory.importance._invoke_importance_llm", _boom)
    assert score_importance("hello", settings=Settings()) == 5
