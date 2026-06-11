"""B1 CASUAL fast lane — bypass LangGraph/checkpoint for deterministic casual speak."""

from __future__ import annotations

import time

import httpx

from src.collective.schemas import SocialTurnOut
from src.config import Settings, get_settings
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
from src.graph.speak_intent import SpeakIntent
from src.graph.state import GraphState


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
    """
    Run a deterministic, synchronous "casual" NPC turn pipeline that fetches state, applies a provided social preview and tools, then composes the final reply.
    
    Parameters:
        room_id (str): Identifier of the chat room or scene.
        player_message (str): The incoming message from the player driving this turn.
        npc_id (str): Identifier of the NPC taking the turn.
        player_id (str): Identifier of the player who sent the message.
        recent_turns (list[dict[str, str]] | None): Optional list of recent turns to seed short-term context.
        preview (SocialTurnOut): Precomputed social perception and reply draft used to seed social processing.
        settings (Settings | None): Optional settings override; if omitted, defaults from get_settings() are used.
    
    Returns:
        GraphState: Updated graph state after applying social perception, tool effects, and reply composition.
    """
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

    t_fetch = time.perf_counter()
    with httpx.Client() as client:
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

    state = apply_social_event(state)
    state = refresh_collective_in_state(state)

    with httpx.Client() as client:
        state = apply_tools(state, settings=cfg, client=client)

    t_compose = time.perf_counter()
    state = compose_reply(state)
    record_phase_ms("t_compose_ms", int((time.perf_counter() - t_compose) * 1000))
    record_phase_ms("t_fast_lane_ms", int((time.perf_counter() - t_total) * 1000))
    return state
