import os
from typing import Any

from langchain_openai import ChatOpenAI

from src.config import Settings, get_settings

PROVIDER_BASE_URLS = {
    "openrouter": "https://openrouter.ai/api/v1",
    "groq": "https://api.groq.com/openai/v1",
    "agnes": "https://apihub.agnes-ai.com/v1",
}


def models_to_try(settings: Settings) -> list[str]:
    seen: set[str] = set()
    models: list[str] = []
    for raw in [settings.llm_model, *settings.llm_model_fallbacks.split(",")]:
        model = raw.strip()
        if model and model not in seen:
            seen.add(model)
            models.append(model)
    return models


def _api_key_for_provider(settings: Settings, provider: str) -> str:
    if provider == "openrouter":
        key = settings.openrouter_api_key
    elif provider == "groq":
        key = settings.groq_api_key
    elif provider == "agnes":
        key = settings.agnes_api_key
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
) -> ChatOpenAI:
    cfg = settings or get_settings()
    chosen_provider = (provider or cfg.llm_provider).lower()
    base_url = PROVIDER_BASE_URLS.get(chosen_provider)
    if not base_url:
        raise ValueError(f"unsupported LLM provider: {chosen_provider}")

    kwargs: dict[str, Any] = {
        "model": model or cfg.llm_model,
        "api_key": _api_key_for_provider(cfg, chosen_provider),
        "base_url": base_url,
        "temperature": 0.7,
    }
    if chosen_provider == "openrouter":
        kwargs["default_headers"] = {
            "HTTP-Referer": os.getenv("OPENROUTER_HTTP_REFERER", "http://localhost:5173"),
            "X-Title": os.getenv("OPENROUTER_APP_TITLE", "AetherLife"),
        }

    return ChatOpenAI(**kwargs)
