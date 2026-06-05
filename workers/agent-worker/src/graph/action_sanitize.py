"""Normalize LLM tool calls into game-actions payloads accepted by apply-actions."""

from __future__ import annotations

from typing import Any

ALLOWED_KEYS: dict[str, frozenset[str]] = {
    "move": frozenset({"type", "x", "y"}),
    "interact": frozenset({"type", "objectId"}),
    "wait": frozenset({"type", "durationMs"}),
    "transfer": frozenset({"type", "itemId", "toNpcId"}),
}

MOVE_ALIASES: dict[str, str] = {
    "targetX": "x",
    "targetY": "y",
    "target_x": "x",
    "target_y": "y",
}


def _coerce_grid_int(value: Any, *, default: int, max_val: int) -> int:
    try:
        if value is None:
            n = default
        else:
            n = int(float(value))
    except (TypeError, ValueError):
        n = default
    return max(0, min(n, max_val))


def normalize_tool_call_to_action(
    call: dict[str, Any],
    *,
    room: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    """Return a strict-schema action dict, or None if the call should be skipped."""
    name = str(call.get("name") or "")
    if name == "speak":
        return None

    args = dict(call.get("args") or {})
    if "type" not in args and name:
        args = {"type": name, **args}

    for src, dst in MOVE_ALIASES.items():
        if src in args and dst not in args:
            args[dst] = args[src]

    action_type = args.get("type")
    if action_type not in ALLOWED_KEYS:
        return None

    allowed = ALLOWED_KEYS[action_type]
    cleaned: dict[str, Any] = {k: args[k] for k in allowed if k in args}
    cleaned["type"] = action_type

    if action_type == "move":
        width = int((room or {}).get("width") or 8)
        height = int((room or {}).get("height") or 8)
        cleaned["x"] = _coerce_grid_int(cleaned.get("x"), default=0, max_val=max(0, width - 1))
        cleaned["y"] = _coerce_grid_int(cleaned.get("y"), default=0, max_val=max(0, height - 1))

    if action_type == "interact":
        oid = cleaned.get("objectId")
        if not oid or not str(oid).strip():
            return None
        cleaned["objectId"] = str(oid).strip()
        if room:
            object_ids = {
                str(obj.get("id"))
                for obj in (room.get("objects") or [])
                if obj.get("id")
            }
            if object_ids and cleaned["objectId"] not in object_ids:
                return None

    if action_type == "wait":
        try:
            ms = int(cleaned.get("durationMs", 1000))
        except (TypeError, ValueError):
            ms = 1000
        cleaned["durationMs"] = max(1, min(ms, 600_000))

    if action_type == "transfer":
        item_id = cleaned.get("itemId")
        to_npc = cleaned.get("toNpcId")
        if not item_id or not to_npc:
            return None
        cleaned["itemId"] = str(item_id).strip()
        cleaned["toNpcId"] = str(to_npc).strip()
        if room:
            npc_ids = {str(npc.get("id")) for npc in (room.get("npcs") or []) if npc.get("id")}
            if npc_ids and cleaned["toNpcId"] not in npc_ids:
                return None

    return cleaned


def tool_calls_to_actions(
    tool_calls: list[dict[str, Any]] | None,
    *,
    room: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    actions: list[dict[str, Any]] = []
    for call in tool_calls or []:
        action = normalize_tool_call_to_action(call, room=room)
        if action is not None:
            actions.append(action)
    return actions
