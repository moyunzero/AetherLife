from typing import Any, TypedDict


class GraphState(TypedDict, total=False):
    room_id: str
    npc_id: str
    player_id: str
    player_message: str
    room_snapshot: dict[str, Any]
    memory_summary: str
    memory_count: int
    retrieved_memories: list[dict[str, Any]]
    latest_bulk: str | None
    latest_reflection: str | None
    tool_calls: list[dict[str, Any]]
    pending_actions: list[dict[str, Any]]
    reply: str
    trace_run_id: str | None
