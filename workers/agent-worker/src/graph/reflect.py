from typing import Any

from src.config import Settings, get_settings
from src.llm.factory import create_chat_model


def run_reflect_llm(memories: list[str], settings: Settings | None = None) -> str:
    cfg = settings or get_settings()
    if cfg.llm_mock:
        joined = "; ".join(memories[:4])
        return f"Recent events: {joined}" if joined else ""

    llm = create_chat_model(
        provider=cfg.llm_provider_reflect,
        model=cfg.llm_model_reflect,
        settings=cfg,
    )
    bullet = "\n".join(f"- {m}" for m in memories if m.strip())
    response = llm.invoke(
        [
            {
                "role": "system",
                "content": (
                    "Summarize these recent NPC memories in 2-4 sentences. "
                    "Preserve proper nouns and codes."
                ),
            },
            {"role": "user", "content": bullet or "(empty)"},
        ]
    )
    return str(getattr(response, "content", "") or "").strip()


def should_reflect(memory_count: int, every_n: int) -> bool:
    return every_n > 0 and memory_count > 0 and memory_count % every_n == 0
