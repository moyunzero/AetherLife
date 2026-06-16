"""Role-specific LLM provider/model resolution.

Platform-aware defaults (see docs/LLM-ROUTING.md §3.1):
- NVIDIA NIM openai/gpt-oss-120b: NPC bind_tools primary (~2s)
- OpenRouter gpt-oss-120b:free: NPC fallback
- NVIDIA llama-3.3-70b: summarize + collective_refine
- SiliconFlow Qwen3.5-4B: optional legacy primary / fallback
- NVIDIA llama-3.3-70b: social JSON primary (~0.9s social JSON bench)
- NVIDIA nano: importance JSON
- Agnes: reflect + lore primary + auxiliary fallback
- OpenRouter: NPC fallback + embeddings + gateway
- Cerebras: optional lore/NPC quality fallback (low RPM)
"""

from __future__ import annotations

import os

from src.config import Settings
from src.llm.factory import PROVIDER_BASE_URLS, models_to_try


def default_model_for_provider(settings: Settings, provider: str) -> str:
    p = provider.lower()
    if p == "agnes":
        return settings.llm_model_reflect
    if p == "groq":
        return "llama-3.1-8b-instant"
    if p == "zhipu":
        return settings.llm_model
    if p == "cerebras":
        return settings.llm_model_cerebras
    if p == "siliconflow":
        return settings.llm_model_siliconflow_fast
    if p == "nvidia":
        return settings.llm_model_nvidia_fast
    if p == "openrouter":
        return settings.llm_model_openrouter_fallback
    models = models_to_try(settings)
    return models[0] if models else settings.llm_model


def _resolve_pair(
    provider: str | None,
    model: str | None,
    *,
    default_provider: str,
    default_model: str,
) -> tuple[str, str]:
    p = (provider or default_provider).lower()
    m = (model or default_model).strip() or default_model
    return p, m


def social_provider_model(settings: Settings) -> tuple[str, str]:
    return _resolve_pair(
        settings.llm_provider_social,
        settings.llm_model_social,
        default_provider=settings.llm_provider_social,
        default_model=settings.llm_model_social or settings.llm_model_nvidia_fast,
    )


def summarize_provider_model(settings: Settings) -> tuple[str, str]:
    default_model = settings.llm_model_summarize or "meta/llama-3.3-70b-instruct"
    return _resolve_pair(
        settings.llm_provider_summarize,
        settings.llm_model_summarize,
        default_provider=settings.llm_provider_summarize,
        default_model=default_model,
    )


def collective_refine_provider_model(settings: Settings) -> tuple[str, str]:
    default_model = settings.llm_model_collective_refine or "meta/llama-3.3-70b-instruct"
    return _resolve_pair(
        settings.llm_provider_collective_refine,
        settings.llm_model_collective_refine,
        default_provider=settings.llm_provider_collective_refine,
        default_model=default_model,
    )


def importance_provider_model(settings: Settings) -> tuple[str, str]:
    return _resolve_pair(
        settings.llm_provider_importance,
        settings.llm_model_importance,
        default_provider=settings.llm_provider_importance,
        default_model=settings.llm_model_importance or settings.llm_model_nvidia_nano,
    )


def auxiliary_provider_attempts(
    settings: Settings,
    *,
    primary: tuple[str, str],
    fallback_provider: str | None = None,
) -> list[tuple[str, str]]:
    """Non-NPC auxiliary LLM attempts — never uses npc_provider_attempts (no Zhipu steal)."""
    attempts: list[tuple[str, str]] = [primary]
    fb = (
        fallback_provider
        or os.getenv("LLM_PROVIDER_AUXILIARY_FALLBACK")
        or settings.llm_provider_auxiliary_fallback
        or settings.llm_provider_social_fallback
        or ""
    ).strip().lower()
    if fb and fb in PROVIDER_BASE_URLS and fb != primary[0]:
        attempts.append((fb, default_model_for_provider(settings, fb)))
    return attempts
