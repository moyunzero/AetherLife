from src.memory.importance import _parse_turn_importance, score_turn_importance


def test_parse_turn_importance_json():
    parsed = _parse_turn_importance('{"player":3,"npc":8}')
    assert parsed == (3, 8)


def test_score_turn_importance_mock(monkeypatch):
    monkeypatch.setenv("LLM_MOCK", "1")
    assert score_turn_importance("move north", "ok") == (5, 5)
