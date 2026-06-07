"""Cerebras provider wiring (no live HTTP — real API via pnpm verify:llm-models)."""

import os
from unittest.mock import patch

import pytest

from src.config import Settings
from src.llm.factory import CEREBRAS_DEFAULT_MODEL, create_chat_model, npc_provider_attempts


@patch.dict(os.environ, {"LLM_MODEL_NPC": ""}, clear=False)
def test_npc_provider_attempts_cerebras_primary():
    settings = Settings.model_construct(
        llm_provider="cerebras",
        llm_model_cerebras=CEREBRAS_DEFAULT_MODEL,
        llm_model_npc=None,
        cerebras_api_key="test-key",
    )
    attempts = npc_provider_attempts(settings)
    assert attempts[0] == ("cerebras", CEREBRAS_DEFAULT_MODEL)


@patch("src.llm.factory._wrap_cerebras_rate_limit", side_effect=lambda llm, _s: llm)
@patch("src.llm.factory.ChatOpenAI")
def test_create_chat_model_cerebras_base_url(mock_chat, _wrap):
    settings = Settings(
        llm_provider="cerebras",
        llm_model=CEREBRAS_DEFAULT_MODEL,
        cerebras_api_key="test-key",
    )
    create_chat_model(settings=settings)
    _, kwargs = mock_chat.call_args
    assert kwargs["base_url"] == "https://api.cerebras.ai/v1"
    assert kwargs["model"] == CEREBRAS_DEFAULT_MODEL
    assert kwargs["max_completion_tokens"] == 4096


def test_create_chat_model_cerebras_missing_key():
    settings = Settings(llm_provider="cerebras", cerebras_api_key=None)
    with pytest.raises(ValueError, match="missing API key"):
        create_chat_model(settings=settings)
