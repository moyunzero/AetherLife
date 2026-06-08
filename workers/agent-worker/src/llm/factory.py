import os
from typing import Any

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_openai import ChatOpenAI

from src.config import Settings, get_settings
from src.llm.cerebras_limits import (
    estimate_prompt_tokens,
    get_cerebras_limiter,
    usage_total_tokens,
)

PROVIDER_BASE_URLS = {
    "openrouter": "https://openrouter.ai/api/v1",
    "groq": "https://api.groq.com/openai/v1",
    "agnes": "https://apihub.agnes-ai.com/v1",
    "zhipu": "https://open.bigmodel.cn/api/paas/v4",
    "cerebras": "https://api.cerebras.ai/v1",
    "siliconflow": "https://api.siliconflow.cn/v1",
    "nvidia": "https://integrate.api.nvidia.com/v1",
}

CEREBRAS_DEFAULT_MODEL = "gpt-oss-120b"
CEREBRAS_MAX_CONTEXT = 65_536

ZHIPU_THINKING_DISABLED = {"thinking": {"type": "disabled"}}
SILICONFLOW_THINKING_DISABLED = {"enable_thinking": False}


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


def _npc_fallback_models(settings: Settings, fallback_provider: str) -> list[str]:
    """Models appropriate for fallback provider — never reuse Zhipu model ids on OpenRouter."""
    pin = os.getenv("LLM_MODEL_FALLBACK", "").strip()
    if pin:
        return [pin]
    from src.llm.roles import default_model_for_provider

    primary_fb = default_model_for_provider(settings, fallback_provider)
    if fallback_provider != "openrouter":
        return [primary_fb]
    models = [primary_fb]
    for model in [m.strip() for m in settings.llm_model_fallbacks.split(",") if m.strip()]:
        if model not in models:
            models.append(model)
    return models


def npc_provider_attempts(settings: Settings) -> list[tuple[str, str]]:
    """Provider+model pairs for NPC tool-calling (never mix provider with foreign model ids)."""
    primary_provider = (settings.llm_provider or "siliconflow").lower()
    pin = (settings.llm_model_npc or os.getenv("LLM_MODEL_NPC") or "").strip()
    if primary_provider == "cerebras":
        primary_model = pin or settings.llm_model_cerebras
    else:
        primary_model = pin or settings.llm_model
    attempts: list[tuple[str, str]] = [(primary_provider, primary_model)]

    fallback_provider = (
        settings.llm_provider_fallback or os.getenv("LLM_PROVIDER_FALLBACK") or ""
    ).strip().lower()
    if not fallback_provider or fallback_provider not in PROVIDER_BASE_URLS:
        return attempts
    if fallback_provider == primary_provider:
        return attempts

    for model in _npc_fallback_models(settings, fallback_provider):
        attempts.append((fallback_provider, model))

    fallback_2 = (os.getenv("LLM_PROVIDER_FALLBACK_2") or "").strip().lower()
    if fallback_2 and fallback_2 in PROVIDER_BASE_URLS and fallback_2 not in {primary_provider, fallback_provider}:
        from src.llm.roles import default_model_for_provider

        attempts.append((fallback_2, default_model_for_provider(settings, fallback_2)))
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
    elif provider == "cerebras":
        key = settings.cerebras_api_key
    elif provider == "siliconflow":
        key = settings.siliconflow_api_key
    elif provider == "nvidia":
        key = settings.nvidia_api_key
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

    resolved_model = model
    if resolved_model is None:
        if chosen_provider == "cerebras":
            resolved_model = cfg.llm_model_cerebras
        elif chosen_provider == "siliconflow":
            resolved_model = cfg.llm_model_siliconflow_fast
        elif chosen_provider == "nvidia":
            resolved_model = cfg.llm_model_nvidia_fast
        else:
            resolved_model = cfg.llm_model

    timeout_s = float(cfg.llm_request_timeout)
    if timeout_s <= 0:
        timeout_s = 120.0

    kwargs: dict[str, Any] = {
        "model": resolved_model,
        "api_key": resolved_key,
        "base_url": base_url,
        "temperature": 0.7 if temperature is None else temperature,
        "timeout": timeout_s,
    }
    if chosen_provider == "openrouter":
        kwargs["default_headers"] = {
            "HTTP-Referer": os.getenv("OPENROUTER_HTTP_REFERER", "http://localhost:5173"),
            "X-Title": os.getenv("OPENROUTER_APP_TITLE", "AetherLife"),
        }
    if chosen_provider == "zhipu":
        kwargs["extra_body"] = ZHIPU_THINKING_DISABLED
    if chosen_provider == "siliconflow":
        kwargs["extra_body"] = SILICONFLOW_THINKING_DISABLED
    if chosen_provider == "cerebras":
        max_out = int(os.getenv("CEREBRAS_MAX_COMPLETION_TOKENS", "4096"))
        kwargs["max_completion_tokens"] = max(256, min(max_out, 32_768))

    llm = ChatOpenAI(**kwargs)
    if chosen_provider == "cerebras":
        return _wrap_cerebras_rate_limit(llm, cfg)
    return llm


def _wrap_cerebras_rate_limit(llm: BaseChatModel, settings: Settings) -> BaseChatModel:
    limiter = get_cerebras_limiter(settings)
    orig_invoke = llm.invoke
    orig_ainvoke = llm.ainvoke

    def invoke(input: Any, config: Any = None, **kwargs: Any) -> Any:
        est = estimate_prompt_tokens(input)
        limiter.acquire(estimated_tokens=est)
        result = orig_invoke(input, config, **kwargs)
        actual = usage_total_tokens(result)
        if actual is not None:
            limiter.adjust_actual_tokens(est, actual)
        return result

    async def ainvoke(input: Any, config: Any = None, **kwargs: Any) -> Any:
        est = estimate_prompt_tokens(input)
        limiter.acquire(estimated_tokens=est)
        result = await orig_ainvoke(input, config, **kwargs)
        actual = usage_total_tokens(result)
        if actual is not None:
            limiter.adjust_actual_tokens(est, actual)
        return result

    llm.invoke = invoke  # type: ignore[method-assign]
    llm.ainvoke = ainvoke  # type: ignore[method-assign]
    return llm
