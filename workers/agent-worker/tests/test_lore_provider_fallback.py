from unittest.mock import MagicMock

import pytest

from src.config import Settings
from src.graph import lore_loop
from src.graph.lore_loop import generate_lore_llm


def test_lore_falls_back_on_primary_auth_error(monkeypatch):
    monkeypatch.delenv("LLM_MOCK", raising=False)
    calls: list[tuple[str, str]] = []

    def fake_invoke(_settings, provider, model, _prompt):
        calls.append((provider, model))
        if provider == "agnes":
            raise Exception("Error code: 403 - Forbidden")
        return (
            '{"nameZh":"测试地","flavorOneLine":"一行","storyHook":"钩子",'
            '"proceduralBiome":"meadow","moodTag":"静","npcRumor":"传闻","hiddenQuestSeed":"seed"}'
        )

    monkeypatch.setattr(lore_loop, "_invoke_lore_llm", fake_invoke)
    settings = Settings(
        llm_mock=False,
        llm_provider_lore="agnes",
        llm_model_lore_t1="agnes-2.0-flash",
        llm_model_lore_t0="agnes-2.0-flash",
        llm_provider_lore_fallback="openrouter",
    )
    monkeypatch.setenv("LLM_MODEL_LORE_FALLBACK", "openrouter/free")

    lore = generate_lore_llm(
        {"dominantBiome": "meadow", "modelTier": "T1", "cx": 0, "cy": 0},
        settings,
    )
    assert lore["nameZh"] == "测试地"
    assert len(calls) == 2
    assert calls[0][0] == "agnes"
    assert calls[1] == ("openrouter", "openrouter/free")


def test_lore_does_not_fallback_on_json_parse_error(monkeypatch):
    monkeypatch.delenv("LLM_MOCK", raising=False)

    def fake_invoke(_settings, provider, model, _prompt):
        if provider == "agnes":
            return "not json at all"
        raise AssertionError("should not reach fallback")

    monkeypatch.setattr(lore_loop, "_invoke_lore_llm", fake_invoke)
    settings = Settings(
        llm_mock=False,
        llm_provider_lore="agnes",
        llm_model_lore_t1="agnes-2.0-flash",
        llm_provider_lore_fallback="openrouter",
    )
    with pytest.raises(ValueError, match="no JSON object"):
        generate_lore_llm({"dominantBiome": "meadow", "modelTier": "T1"}, settings)
