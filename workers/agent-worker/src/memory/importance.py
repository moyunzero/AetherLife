import os

from src.config import Settings, get_settings
from src.llm.openrouter_chat import invoke_chat_llm

DEFAULT_IMPORTANCE = 5


def _clamp(value: float) -> int:
    return max(1, min(10, round(value)))


def _parse_importance(content: str) -> int | None:
    import json
    import re

    text = content.strip()
    try:
        parsed = json.loads(text)
        if isinstance(parsed.get("importance"), (int, float)):
            return _clamp(float(parsed["importance"]))
    except json.JSONDecodeError:
        match = re.search(r"\b([1-9]|10)\b", text)
        if match:
            return _clamp(float(match.group(1)))
    return None


def score_importance(text: str, settings: Settings | None = None) -> int:
    if os.getenv("LLM_MOCK") == "1":
        return DEFAULT_IMPORTANCE

    cfg = settings or get_settings()
    if cfg.llm_mock:
        return DEFAULT_IMPORTANCE

    content = invoke_chat_llm(
        [
            {
                "role": "system",
                "content": (
                    'Rate NPC memory importance 1-10. Reply JSON only: {"importance":N}'
                ),
            },
            {"role": "user", "content": text[:500]},
        ],
        settings=cfg,
        temperature=0,
    )
    return _parse_importance(content) or DEFAULT_IMPORTANCE
