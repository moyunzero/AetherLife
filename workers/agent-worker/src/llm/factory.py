import os
from typing import Any

from langchain_openai import ChatOpenAI

from src.config import Settings, get_settings

PROVIDER_BASE_URLS = {
    "openrouter": "https://openrouter.ai/api/v1",
    "groq": "https://api.groq.com/openai/v1",
    "agnes": "https://apihub.agnes-ai.com/v1",
    "zhipu": "https://open.bigmodel.cn/api/paas/v4",
}

ZHIPU_THINKING_DISABLED = {"thinking": {"type": "disabled"}}


def models_to_try(settings: Settings) -> list[str]:
    seen: set[str] = set()
    models: list[str] = []
    for raw in [settings.llm_model, *settings.llm_model_fallbacks.split(",")]:
        model = raw.strip()
        if model and model not in seen:
            seen.add(model)
            models.append(model)
    return models


def npc_models_to_try(settings: Settings) -> list[str]:
    """NPC tool-calling models: optional LLM_MODEL_NPC pin, then LLM_MODEL + fallbacks."""
    seen: set[str] = set()
    models: list[str] = []
    pin = (settings.llm_model_npc or os.getenv("LLM_MODEL_NPC") or "").strip()
    if pin:
        seen.add(pin)
        models.append(pin)
    for model in models_to_try(settings):
        if model not in seen:
            seen.add(model)
            models.append(model)
    return models


def npc_provider_attempts(settings: Settings) -> list[tuple[str, str]]:
    """Provider+model pairs for NPC tool-calling (never mix provider with foreign model ids)."""
    primary_provider = (settings.llm_provider or "zhipu").lower()
    pin = (settings.llm_model_npc or os.getenv("LLM_MODEL_NPC") or "").strip()
    primary_model = pin or settings.llm_model
    attempts: list[tuple[str, str]] = [(primary_provider, primary_model)]

    fallback_provider = (
        settings.llm_provider_fallback or os.getenv("LLM_PROVIDER_FALLBACK") or ""
    ).strip().lower()
    if not fallback_provider or fallback_provider not in PROVIDER_BASE_URLS:
        return attempts
    if fallback_provider == primary_provider:
        return attempts

    fallback_models = models_to_try(settings)
    if not fallback_models:
        fallback_models = [settings.llm_model]
    for model in fallback_models:
        attempts.append((fallback_provider, model))
    return attempts


def _api_key_for_provider(settings: Settings, provider: str) -> str:
    if provider == "openrouter":
        key = settings.openrouter_api_key
    elif provider == "groq":
        key = settings.groq_api_key
    elif provider == "agnes":
        key = settings.agnes_api_key
    elif provider == "zhipu":
        key = settings.zhipu_api_key
    else:
        raise ValueError(f"unsupported LLM provider: {provider}")

    if not key:
        raise ValueError(f"missing API key for provider {provider}")
    return key


def create_chat_model(
    *,
    provider: str | None = None,
    model: str | None = None,
    settings: Settings | None = None,
    api_key: str | None = None,
    temperature: float | None = None,
) -> ChatOpenAI:
    cfg = settings or get_settings()
    chosen_provider = (provider or cfg.llm_provider).lower()
    base_url = PROVIDER_BASE_URLS.get(chosen_provider)
    if not base_url:
        raise ValueError(f"unsupported LLM provider: {chosen_provider}")

    resolved_key = api_key if api_key else _api_key_for_provider(cfg, chosen_provider)

    kwargs: dict[str, Any] = {
        "model": model or cfg.llm_model,
        "api_key": resolved_key,
        "base_url": base_url,
        "temperature": 0.7 if temperature is None else temperature,
    }
    if chosen_provider == "openrouter":
        kwargs["default_headers"] = {
            "HTTP-Referer": os.getenv("OPENROUTER_HTTP_REFERER", "http://localhost:5173"),
            "X-Title": os.getenv("OPENROUTER_APP_TITLE", "AetherLife"),
        }
    if chosen_provider == "zhipu":
        kwargs["extra_body"] = ZHIPU_THINKING_DISABLED

    return ChatOpenAI(**kwargs)
