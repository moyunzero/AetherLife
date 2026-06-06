"""Zhipu provider wiring (no live HTTP — real API via pnpm verify:llm-models)."""

from unittest.mock import patch

import pytest

from src.config import Settings
from src.llm.factory import (
    ZHIPU_THINKING_DISABLED,
    npc_provider_attempts,
    create_chat_model,
)


def test_npc_provider_attempts_zhipu_primary():
    settings = Settings(
        llm_provider="zhipu",
        llm_model="glm-4.7-flash",
        llm_model_npc="glm-4.7-flash",
        llm_provider_fallback="openrouter",
        llm_model_fallbacks="openrouter/free",
    )
    attempts = npc_provider_attempts(settings)
    assert attempts[0] == ("zhipu", "glm-4.7-flash")
    assert ("openrouter", "glm-4.7-flash") in attempts or ("openrouter", "openrouter/free") in attempts


@patch("src.llm.factory.ChatOpenAI")
def test_create_chat_model_zhipu_thinking_disabled(mock_chat):
    settings = Settings(
        llm_provider="zhipu",
        llm_model="glm-4.7-flash",
        zhipu_api_key="test-key",
    )
    create_chat_model(settings=settings)
    _, kwargs = mock_chat.call_args
    assert kwargs["base_url"] == "https://open.bigmodel.cn/api/paas/v4"
    assert kwargs["model"] == "glm-4.7-flash"
    assert kwargs["extra_body"] == ZHIPU_THINKING_DISABLED


def test_create_chat_model_zhipu_missing_key():
    settings = Settings(llm_provider="zhipu", zhipu_api_key=None)
    with pytest.raises(ValueError, match="missing API key"):
        create_chat_model(settings=settings)
