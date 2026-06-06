"""Chat invoke with OpenRouter key rotation on 429."""

import sys
from typing import Any

from src.config import Settings, get_settings
from src.llm.errors import is_rate_limit_error
from src.llm.factory import create_chat_model
from src.llm.openrouter_keys import openrouter_keys


def invoke_chat_llm(
    messages: list[Any],
    *,
    settings: Settings | None = None,
    model: str | None = None,
    provider: str | None = None,
    temperature: float | None = None,
) -> str:
    cfg = settings or get_settings()
    chosen_provider = (provider or cfg.llm_provider).lower()
    resolved_model = model or cfg.llm_model

    if chosen_provider == "openrouter":
        keys: list[str | None] = openrouter_keys(cfg) or [None]
    else:
        keys = [None]

    last_exc: BaseException | None = None
    for key_idx, or_key in enumerate(keys):
        try:
            llm = create_chat_model(
                provider=chosen_provider,
                model=resolved_model,
                settings=cfg,
                api_key=or_key,
                temperature=temperature,
            )
            response = llm.invoke(messages)
            return str(getattr(response, "content", "") or "")
        except Exception as exc:
            last_exc = exc
            if (
                chosen_provider == "openrouter"
                and is_rate_limit_error(exc)
                and key_idx + 1 < len(keys)
            ):
                print(
                    f"LLM OpenRouter key #{key_idx + 1} rate-limited, trying next key",
                    file=sys.stderr,
                )
                continue
            raise
    assert last_exc is not None
    raise last_exc
