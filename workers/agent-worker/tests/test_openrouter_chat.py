from unittest.mock import MagicMock

import pytest

from src.config import Settings
from src.llm.errors import (
    is_connection_error,
    should_try_lore_provider_fallback,
)
from src.llm.factory import npc_models_to_try
from src.llm.openrouter_chat import invoke_chat_llm


def test_is_connection_error():
    assert is_connection_error(Exception("Connection refused"))
    assert not is_connection_error(Exception("Error code: 429"))


def test_should_try_lore_provider_fallback_auth_and_retryable():
    assert should_try_lore_provider_fallback(Exception("Error code: 403 - Forbidden"))
    assert should_try_lore_provider_fallback(Exception("Error code: 429 - rate limit"))
    assert should_try_lore_provider_fallback(Exception("Connection timed out"))
    assert not should_try_lore_provider_fallback(ValueError("bad json"))


def test_npc_models_to_try_pins_llm_model_npc(monkeypatch):
    monkeypatch.setenv("LLM_MODEL_NPC", "meta-llama/llama-3.3-70b-instruct:free")
    settings = Settings(
        llm_model="openrouter/free",
        llm_model_fallbacks="",
    )
    assert npc_models_to_try(settings) == [
        "meta-llama/llama-3.3-70b-instruct:free",
        "openrouter/free",
    ]


def test_invoke_chat_llm_rotates_openrouter_keys_on_429(monkeypatch):
    settings = Settings(
        llm_provider="openrouter",
        openrouter_api_key="key-a",
        openrouter_api_key_2="key-b",
        llm_model="openrouter/free",
    )
    seen_keys: list[str | None] = []

    def fake_create(**kwargs):
        seen_keys.append(kwargs.get("api_key"))
        llm = MagicMock()
        if kwargs.get("api_key") == "key-a":
            llm.invoke.side_effect = Exception("Error code: 429 - rate-limited")
        else:
            llm.invoke.return_value = MagicMock(content='{"importance":8}')
        return llm

    monkeypatch.setattr("src.llm.openrouter_chat.create_chat_model", fake_create)

    content = invoke_chat_llm(
        [{"role": "user", "content": "x"}],
        settings=settings,
        temperature=0,
    )
    assert content == '{"importance":8}'
    assert seen_keys == ["key-a", "key-b"]
