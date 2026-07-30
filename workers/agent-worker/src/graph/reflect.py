from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any

from src.config import Settings, get_settings
from src.llm.factory import create_chat_model

# Mirror packages/shared NPC_MOODS (D-BELIEF-08) — closed Chinese set, no English aliases.
NPC_MOODS: tuple[str, ...] = (
    "平静",
    "亲近",
    "警惕",
    "恼火",
    "愉悦",
    "低落",
    "愧疚",
    "戏谑",
)

_NPC_MOOD_SET = frozenset(NPC_MOODS)

_REFLECT_SYSTEM = (
    "You are an NPC reflecting on recent memories. Reply with JSON only "
    '(no markdown): {"text": "2-4 sentence prose reflection preserving proper nouns", '
    f'"mood": one of {list(NPC_MOODS)}, '
    '"beliefs": ["NPC first-person short zh sentences", ...], '
    '"summary": "optional <=200 zh chars"}. '
    "beliefs: at most 5 items, each <=40 chars, first person (e.g. 我不信他的承诺). "
    "mood must be exactly one whitelist value."
)


@dataclass(frozen=True)
class ReflectStructured:
    """Structured reflect output (D-BELIEF-03/07/09/13). Semantic fields may be None to omit."""

    text: str
    mood: str | None = None
    beliefs: list[str] | None = None
    summary: str | None = None


def _parse_reflect_json(content: str) -> ReflectStructured | None:
    text = content.strip()
    if not text:
        return None

    parsed: Any = None
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if match:
            try:
                parsed = json.loads(match.group(0))
            except json.JSONDecodeError:
                return None
        else:
            return None

    if not isinstance(parsed, dict):
        return None

    prose = parsed.get("text")
    if not isinstance(prose, str) or not prose.strip():
        return None

    mood_raw = parsed.get("mood")
    mood: str | None = None
    if isinstance(mood_raw, str) and mood_raw in _NPC_MOOD_SET:
        mood = mood_raw

    beliefs: list[str] | None = None
    beliefs_raw = parsed.get("beliefs")
    if isinstance(beliefs_raw, list):
        beliefs = [
            b.strip()[:40]
            for b in beliefs_raw
            if isinstance(b, str) and b.strip()
        ][:5]

    summary: str | None = None
    summary_raw = parsed.get("summary")
    if isinstance(summary_raw, str):
        summary = summary_raw[:200]

    return ReflectStructured(
        text=prose.strip(),
        mood=mood,
        beliefs=beliefs,
        summary=summary,
    )


def run_reflect_llm_structured(
    memories: list[str],
    settings: Settings | None = None,
) -> ReflectStructured | None:
    """Single reflect LLM call returning prose + optional mood/beliefs (zero extra round-trips)."""
    cfg = settings or get_settings()
    if cfg.llm_mock:
        joined = "; ".join(memories[:4])
        prose = f"Recent events: {joined}" if joined else ""
        if not prose:
            return None
        return ReflectStructured(
            text=prose,
            mood="平静",
            beliefs=["我记得最近发生的事"],
            summary=None,
        )

    llm = create_chat_model(
        provider=cfg.llm_provider_reflect,
        model=cfg.llm_model_reflect,
        settings=cfg,
    )
    bullet = "\n".join(f"- {m}" for m in memories if m.strip())
    response = llm.invoke(
        [
            {"role": "system", "content": _REFLECT_SYSTEM},
            {"role": "user", "content": bullet or "(empty)"},
        ]
    )
    content = str(getattr(response, "content", "") or "").strip()
    return _parse_reflect_json(content)


def run_reflect_llm(memories: list[str], settings: Settings | None = None) -> str:
    """Backward-compatible prose wrapper around structured reflect."""
    out = run_reflect_llm_structured(memories, settings)
    return out.text if out else ""


def should_reflect(memory_count: int, every_n: int) -> bool:
    return every_n > 0 and memory_count > 0 and memory_count % every_n == 0
