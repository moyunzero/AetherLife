"""Unified speak system-prompt assembly (legacy tool path + social path)."""

from __future__ import annotations

from src.graph.persona import build_persona_block
from src.graph.state import GraphState

# Injected after Memory summary for social path only (byte-stable when unchanged).
SOCIAL_MEMORY_RECALL_HINT = (
    "若玩家追问 Memory summary 中已有的事实，reply 须直接给出答案，勿拒绝或说「不记得」。"
)


def build_speak_system_context(
    state: GraphState,
    *,
    base_prompt: str,
    include_just_happened: bool = False,
    memory_suffix: str = "",
    system_append: str = "",
    timeline_context: str = "",
) -> str:
    """Assemble system text: persona → room → attitude → memory → canon → timeline → append.

    ``timeline_context`` defaults empty (Phase 27 injection seam); empty string is a no-op.
    """
    # Lazy import avoids circular import with prompt.build_turn_messages.
    from src.graph.prompt import build_room_constraints, format_attitude_context

    room = state.get("room_snapshot") or {}
    attitude = format_attitude_context(
        band=state.get("attitude_band"),
        effective_score=state.get("effective_score"),
        summaries=state.get("collective_summaries"),
        just_happened=(
            state.get("just_happened_summary") if include_just_happened else None
        ),
        mood=state.get("current_mood"),
        beliefs=state.get("key_beliefs"),
        summary=state.get("attitude_summary"),
    )
    npc_id = state.get("npc_id") or "npc-1"
    persona_block = build_persona_block(
        npc_id,
        runtime_relationships=state.get("runtime_relationships"),
    )
    system_text = base_prompt
    if persona_block:
        system_text = f"{system_text}\n\n{persona_block}"
    system_text = f"{system_text}\n{build_room_constraints(room)}\n\n{attitude}"
    memory = (state.get("memory_summary") or "").strip()
    if memory:
        memory_block = f"Memory summary:\n{memory}"
        suffix = (memory_suffix or "").strip()
        if suffix:
            memory_block = f"{memory_block}\n{suffix}"
        system_text = f"{system_text}\n\n{memory_block}"
    canon = (state.get("canon_context") or "").strip()
    if canon:
        system_text = f"{system_text}\n\n{canon}"
    timeline = (timeline_context or "").strip()
    if timeline:
        system_text = f"{system_text}\n\n{timeline}"
    append = (system_append or "").strip()
    if append:
        system_text = f"{system_text}\n\n{append}"
    return system_text
