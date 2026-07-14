from src.config import Settings
from src.llm.roles import (
    auxiliary_provider_attempts,
    collective_refine_provider_model,
    default_model_for_provider,
    importance_provider_model,
    social_provider_model,
    summarize_provider_model,
)


def test_social_defaults_to_groq_llama_70b(monkeypatch):
    monkeypatch.delenv("LLM_PROVIDER_SOCIAL", raising=False)
    monkeypatch.delenv("LLM_MODEL_SOCIAL", raising=False)
    monkeypatch.delenv("LLM_MODEL_NVIDIA_FAST", raising=False)
    provider, model = social_provider_model(Settings(_env_file=None))
    assert provider == "groq"
    assert model == "llama-3.3-70b-versatile"


def test_summarize_respects_env_override():
    provider, model = summarize_provider_model(
        Settings(llm_provider_summarize="groq", llm_model_summarize="llama-3.1-8b-instant")
    )
    assert provider == "groq"
    assert model == "llama-3.1-8b-instant"


def test_summarize_defaults_to_nvidia_llama():
    provider, model = summarize_provider_model(Settings())
    assert provider == "nvidia"
    assert "llama" in model.lower()


def test_collective_refine_defaults_to_nvidia():
    provider, model = collective_refine_provider_model(Settings())
    assert provider == "nvidia"
    assert "llama" in model.lower()


def test_importance_defaults_to_nvidia_nano():
    provider, model = importance_provider_model(Settings())
    assert provider == "nvidia"
    assert "nemotron-nano" in model


def test_auxiliary_attempts_never_includes_zhipu_by_default(monkeypatch):
    monkeypatch.delenv("LLM_PROVIDER_SOCIAL", raising=False)
    monkeypatch.delenv("LLM_MODEL_SOCIAL", raising=False)
    monkeypatch.delenv("LLM_PROVIDER_AUXILIARY_FALLBACK", raising=False)
    settings = Settings(
        _env_file=None,
        llm_provider_social="nvidia",
        llm_model_social="meta/llama-3.3-70b-instruct",
        llm_provider_social_fallback="agnes",
        llm_provider_auxiliary_fallback="agnes",
    )
    primary = social_provider_model(settings)
    attempts = auxiliary_provider_attempts(settings, primary=primary)
    assert attempts[0][0] == "nvidia"
    assert attempts[1][0] == "agnes"
    assert all(p != "zhipu" for p, _ in attempts)


def test_auxiliary_attempts_optional_fallback(monkeypatch):
    monkeypatch.delenv("LLM_PROVIDER_AUXILIARY_FALLBACK", raising=False)
    settings = Settings(
        _env_file=None,
        llm_provider_social="nvidia",
        llm_model_social="meta/llama-3.3-70b-instruct",
        llm_provider_social_fallback="agnes",
        llm_provider_auxiliary_fallback="agnes",
    )
    primary = social_provider_model(settings)
    attempts = auxiliary_provider_attempts(
        settings,
        primary=primary,
        fallback_provider=settings.llm_provider_social_fallback,
    )
    assert len(attempts) == 2
    assert attempts[1][0] == "agnes"


def test_default_model_for_groq_uses_gpt_oss_120b():
    settings = Settings()
    assert default_model_for_provider(settings, "groq") == "openai/gpt-oss-120b"


def test_default_model_for_siliconflow_and_nvidia():
    settings = Settings()
    assert "Qwen" in default_model_for_provider(settings, "siliconflow")
    assert default_model_for_provider(settings, "nvidia") == "meta/llama-3.3-70b-instruct"


def test_openrouter_fallback_uses_openrouter_model_not_zhipu():
    settings = Settings(llm_provider="zhipu", llm_model="glm-4.7-flash")
    model = default_model_for_provider(settings, "openrouter")
    assert model != "glm-4.7-flash"
    assert model == settings.llm_model_openrouter_fallback


def test_npc_provider_attempts_includes_groq_fallback_2(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER_FALLBACK_2", "groq")
    settings = Settings(
        _env_file=None,
        llm_provider="nvidia",
        llm_model_npc="openai/gpt-oss-120b",
        llm_provider_fallback="openrouter",
    )
    from src.llm.factory import npc_provider_attempts

    attempts = npc_provider_attempts(settings)
    assert attempts[0] == ("nvidia", "openai/gpt-oss-120b")
    assert ("openrouter", settings.llm_model_openrouter_fallback) in attempts
    assert ("groq", "openai/gpt-oss-120b") in attempts
