from __future__ import annotations

import json
import os
import re
from typing import Any

from pydantic import BaseModel, Field, field_validator

from src.config import Settings, get_settings
from src.llm.openrouter_chat import invoke_chat_llm
from src.llm.roles import collective_refine_provider_model

from .constants import COLLECTIVE_EVENT_KINDS
from .repository import CollectiveRepository
from .scoring import clamp_llm_refine_delta

REFINE_IMPORTANCE_THRESHOLD = 7


class CollectiveRefineOut(BaseModel):
    kind: str
    summary: str = Field(max_length=80)
    delta: int = Field(ge=-10, le=10)

    @field_validator("kind")
    @classmethod
    def validate_kind(cls, value: str) -> str:
        if value not in COLLECTIVE_EVENT_KINDS:
            raise ValueError(f"invalid kind: {value}")
        return value


def _parse_refine_json(content: str) -> CollectiveRefineOut | None:
    text = content.strip()
    try:
        parsed = json.loads(text)
        return CollectiveRefineOut.model_validate(parsed)
    except (json.JSONDecodeError, ValueError):
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if match:
            try:
                return CollectiveRefineOut.model_validate(json.loads(match.group(0)))
            except (json.JSONDecodeError, ValueError):
                return None
    return None


def run_collective_refine_llm(
    player_message: str,
    *,
    settings: Settings | None = None,
) -> CollectiveRefineOut | None:
    if os.getenv("LLM_MOCK") == "1":
        return CollectiveRefineOut(kind="rude", summary="玩家言语不敬", delta=-8)

    cfg = settings or get_settings()
    if cfg.llm_mock:
        return CollectiveRefineOut(kind="rude", summary="玩家言语不敬", delta=-8)

    provider, model = collective_refine_provider_model(cfg)
    content = invoke_chat_llm(
        [
            {
                "role": "system",
                "content": (
                    "Classify player social tone for NPC collective memory. "
                    f"Reply JSON only: {{\"kind\": one of {list(COLLECTIVE_EVENT_KINDS)}, "
                    '"summary": "<=80 zh chars neutral>", "delta": int -10..10}}'
                ),
            },
            {"role": "user", "content": player_message[:500]},
        ],
        settings=cfg,
        provider=provider,
        model=model,
        temperature=0,
    )
    return _parse_refine_json(content)


def maybe_collective_refine(state: dict[str, Any], *, settings: Settings | None = None) -> dict[str, Any]:
    if state.get("social_applied") or state.get("collective_updated"):
        return state

    importance = int(state.get("turn_importance") or 0)
    ambiguous = bool(state.get("collective_ambiguous"))
    if importance < REFINE_IMPORTANCE_THRESHOLD and not ambiguous:
        return state

    player_message = (state.get("player_message") or "").strip()
    if not player_message:
        return state

    refined = run_collective_refine_llm(player_message, settings=settings)
    if refined is None:
        return state

    delta = clamp_llm_refine_delta(refined.delta)
    repo = CollectiveRepository()
    player_id = state.get("player_id") or "__legacy__"
    repo.insert_refined_event(
        room_id=state["room_id"],
        npc_id=state.get("npc_id") or "npc-1",
        kind=refined.kind,
        summary=refined.summary,
        player_ids=[player_id],
        delta_score=delta,
    )
    repo.prune_expired()
    return state
