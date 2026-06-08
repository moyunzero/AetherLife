"""NPC provider attempts when SiliconFlow is primary (Phase 12.2)."""

from src.config import Settings
from src.llm.factory import npc_provider_attempts


def test_npc_provider_attempts_siliconflow_primary():
    settings = Settings(
        llm_provider="siliconflow",
        llm_model="Qwen/Qwen3.5-4B",
        llm_model_npc="Qwen/Qwen3.5-4B",
        llm_provider_fallback="openrouter",
        llm_model_openrouter_fallback="openrouter/free",
    )
    attempts = npc_provider_attempts(settings)
    assert attempts[0] == ("siliconflow", "Qwen/Qwen3.5-4B")
    assert attempts[0][0] != "zhipu"
    assert attempts[1][0] == "openrouter"


def test_npc_provider_attempts_zhipu_not_first_when_siliconflow_env():
    settings = Settings(
        llm_provider="siliconflow",
        llm_model="Qwen/Qwen3.5-4B",
        llm_provider_fallback="zhipu",
    )
    attempts = npc_provider_attempts(settings)
    assert attempts[0][0] == "siliconflow"
    if len(attempts) > 1:
        assert attempts[1][0] == "zhipu"
