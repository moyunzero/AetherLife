"""B1 CASUAL fast lane — bypass LangGraph/checkpoint for deterministic casual speak."""

from __future__ import annotations

import time

import httpx

from src.collective.schemas import SocialTurnOut, is_social_skip
from src.collective.social_turn import reconcile_social_perception
from src.config import Settings, get_settings
from src.http_json import create_http_client
from src.graph.action_intent import player_requests_physical_action
from src.graph.job_context import record_phase_ms
from src.graph.npc_loop import (
    _neutral_memory_fields,
    _npc_turn_initial,
    apply_social_event,
    apply_tools,
    compose_reply,
    fetch_state,
    refresh_collective_in_state,
)
from src.graph.reply_sanitize import sanitize_npc_reply
from src.graph.speak_intent import SpeakIntent
from src.graph.state import GraphState


def _can_short_circuit_casual_lane(
    preview: SocialTurnOut,
    player_message: str,
) -> bool:
    """Pure casual: no physical tools and no collective side effects after reconcile."""
    if player_requests_physical_action(player_message):
        return False
    perception = reconcile_social_perception(
        player_message.strip(),
        preview.social,
    )
    return is_social_skip(perception)


def run_casual_fast_lane(
    *,
    room_id: str,
    player_message: str,
    npc_id: str,
    player_id: str,
    recent_turns: list[dict[str, str]] | None,
    preview: SocialTurnOut,
    settings: Settings | None = None,
) -> GraphState:
    """Sync pipeline without StateGraph: fetch → social → compose."""
    cfg = settings or get_settings()
    t_total = time.perf_counter()

    state = _npc_turn_initial(
        room_id=room_id,
        player_message=player_message,
        npc_id=npc_id,
        player_id=player_id,
        recent_turns=recent_turns,
    )
    state["speak_intent"] = SpeakIntent.CASUAL.value
    record_phase_ms("t_memory_ms", 0)
    record_phase_ms("t_social_llm_ms", 0)

    with create_http_client() as client:
        t_fetch = time.perf_counter()
        state = fetch_state(
            state,
            settings=cfg,
            client=client,
            skip_nearby_lore=True,
        )
        record_phase_ms("t_fetch_state_ms", int((time.perf_counter() - t_fetch) * 1000))
        state = {**state, **_neutral_memory_fields()}

        state = {
            **state,
            "social_perception": preview.social.model_dump(),
            "reply_draft": preview.reply,
            "tool_calls": [],
            "social_applied": False,
            "collective_updated": False,
        }

        if _can_short_circuit_casual_lane(preview, player_message):
            record_phase_ms("t_compose_ms", 0)
            record_phase_ms("t_apply_ms", 0)
            reply = sanitize_npc_reply(preview.reply.strip())
            record_phase_ms("t_fast_lane_ms", int((time.perf_counter() - t_total) * 1000))
            return {**state, "reply": reply}

        state = apply_social_event(state)
        state = refresh_collective_in_state(state)
        state = apply_tools(state, settings=cfg, client=client)

        t_compose = time.perf_counter()
        state = compose_reply(state)
        record_phase_ms("t_compose_ms", int((time.perf_counter() - t_compose) * 1000))

    record_phase_ms("t_fast_lane_ms", int((time.perf_counter() - t_total) * 1000))
    return state
