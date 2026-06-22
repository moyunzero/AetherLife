"""Deterministic SOCIAL_EDGE fast lane — rude/help backstop without LangGraph checkpoint."""

from __future__ import annotations

import time

import httpx

from src.collective.schemas import SocialTurnOut
from src.collective.social_turn import reconcile_social_perception
from src.config import Settings, get_settings
from src.http_json import create_http_client
from src.graph.job_context import record_phase_ms
from src.graph.npc_loop import (
    _npc_turn_initial,
    apply_social_event,
    apply_tools,
    compose_reply,
    fetch_state_and_memory,
    refresh_collective_in_state,
)
from src.graph.speak_intent import SpeakIntent
from src.graph.state import GraphState


def run_social_edge_fast_lane(
    *,
    room_id: str,
    player_message: str,
    npc_id: str,
    player_id: str,
    recent_turns: list[dict[str, str]] | None,
    preview: SocialTurnOut,
    settings: Settings | None = None,
) -> GraphState:
    """Sync pipeline: parallel fetch+memory → apply social → tools → reply."""
    cfg = settings or get_settings()
    t_total = time.perf_counter()

    state = _npc_turn_initial(
        room_id=room_id,
        player_message=player_message,
        npc_id=npc_id,
        player_id=player_id,
        recent_turns=recent_turns,
    )
    state["speak_intent"] = SpeakIntent.SOCIAL_EDGE.value
    record_phase_ms("t_social_llm_ms", 0)

    with create_http_client() as client:
        state = fetch_state_and_memory(state, settings=cfg, client=client)

        player_msg = player_message.strip()
        reconciled = reconcile_social_perception(player_msg, preview.social)
        turn = preview.model_copy(update={"social": reconciled})

        state = {
            **state,
            "social_perception": turn.social.model_dump(),
            "reply_draft": turn.reply,
            "tool_calls": [],
            "social_applied": False,
            "collective_updated": False,
        }

        state = apply_social_event(state)
        state = refresh_collective_in_state(state)
        state = apply_tools(state, settings=cfg, client=client)

    t_compose = time.perf_counter()
    state = compose_reply(state)
    record_phase_ms("t_compose_ms", int((time.perf_counter() - t_compose) * 1000))
    record_phase_ms("t_fast_lane_ms", int((time.perf_counter() - t_total) * 1000))
    return state
