import json
import os
import re

from src.config import Settings, get_settings
from src.llm.errors import is_rate_limit_error
from src.llm.openrouter_chat import invoke_chat_llm
from src.llm.roles import importance_provider_model

DEFAULT_IMPORTANCE = 5


def _clamp(value: float) -> int:
    return max(1, min(10, round(value)))


def _parse_importance(content: str) -> int | None:
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


def _importance_provider(cfg: Settings) -> tuple[str, str]:
    return importance_provider_model(cfg)


def _invoke_importance_llm(messages: list[dict[str, str]], settings: Settings) -> str:
    provider, model = _importance_provider(settings)
    return invoke_chat_llm(
        messages,
        settings=settings,
        provider=provider,
        model=model,
        temperature=0,
    )


def score_importance(text: str, settings: Settings | None = None) -> int:
    if os.getenv("LLM_MOCK") == "1":
        return DEFAULT_IMPORTANCE

    cfg = settings or get_settings()
    if cfg.llm_mock:
        return DEFAULT_IMPORTANCE

    try:
        content = _invoke_importance_llm(
            [
                {
                    "role": "system",
                    "content": (
                        'Rate NPC memory importance 1-10. Reply JSON only: {"importance":N}'
                    ),
                },
                {"role": "user", "content": text[:500]},
            ],
            cfg,
        )
    except Exception as exc:
        if is_rate_limit_error(exc):
            return DEFAULT_IMPORTANCE
        raise
    return _parse_importance(content) or DEFAULT_IMPORTANCE


def _parse_turn_importance(content: str) -> tuple[int, int] | None:
    text = content.strip()
    try:
        parsed = json.loads(text)
        player = parsed.get("player")
        npc = parsed.get("npc")
        if isinstance(player, (int, float)) and isinstance(npc, (int, float)):
            return _clamp(float(player)), _clamp(float(npc))
    except json.JSONDecodeError:
        pass
    return None


def score_turn_importance(
    player_message: str,
    npc_text: str,
    settings: Settings | None = None,
) -> tuple[int, int]:
    """Single LLM call for player + npc importance (P2); uses importance provider, not main Zhipu."""
    if os.getenv("LLM_MOCK") == "1":
        return DEFAULT_IMPORTANCE, DEFAULT_IMPORTANCE

    cfg = settings or get_settings()
    if cfg.llm_mock:
        return DEFAULT_IMPORTANCE, DEFAULT_IMPORTANCE

    player_line = (
        player_message
        if player_message.startswith("player:")
        else f"player: {player_message}"
    )
    npc_line = npc_text if npc_text.startswith("npc:") else f"npc: {npc_text}"

    try:
        content = _invoke_importance_llm(
            [
                {
                    "role": "system",
                    "content": (
                        "Rate long-term memory importance 1-10 for each line. "
                        'Reply JSON only: {"player":N,"npc":M}'
                    ),
                },
                {
                    "role": "user",
                    "content": f"{player_line[:400]}\n{npc_line[:400]}",
                },
            ],
            cfg,
        )
    except Exception as exc:
        if is_rate_limit_error(exc):
            return DEFAULT_IMPORTANCE, DEFAULT_IMPORTANCE
        raise

    parsed = _parse_turn_importance(content)
    if parsed:
        return parsed
    return DEFAULT_IMPORTANCE, DEFAULT_IMPORTANCE
