from typing import Any, TypedDict


class DialogueTurn(TypedDict):
    role: str
    text: str


class GraphState(TypedDict, total=False):
    room_id: str
    npc_id: str
    player_id: str
    player_message: str
    recent_turns: list[DialogueTurn]
    room_snapshot: dict[str, Any]
    memory_summary: str
    memory_count: int
    retrieved_memories: list[dict[str, Any]]
    latest_bulk: str | None
    latest_reflection: str | None
    attitude_band: str
    effective_score: int
    allowed_tools: list[str]
    collective_summaries: list[str]
    current_mood: str
    key_beliefs: list[str]
    attitude_summary: str
    turn_importance: int
    collective_ambiguous: bool
    gate_rejected: bool
    gate_kind: str
    social_perception: dict[str, Any]
    reply_draft: str
    social_applied: bool
    collective_updated: bool
    just_happened_summary: str
    speak_intent: str
    runtime_relationships: list[dict[str, Any]]
    canon_context: str
    phase_timing_ms: dict[str, int]
    tool_calls: list[dict[str, Any]]
    pending_actions: list[dict[str, Any]]
    reply: str
    trace_run_id: str | None
    manipulation_intent: str
    belief_decision: str
    belief_rejected: bool
    belief_ab_applied: bool
    belief_day_key: str
