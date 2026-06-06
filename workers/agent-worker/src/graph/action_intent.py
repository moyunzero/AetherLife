import re
from typing import Any

STATE_CHANGING_TOOLS = frozenset({"move", "interact", "wait"})

EXPLICIT_COORD_PATTERN = re.compile(r"[\(（]\s*\d+\s*[,，]\s*\d+\s*[\)）]")

MOVE_PATTERNS = (
    r"移动",
    r"走到",
    r"走去",
    r"去\s*[\(（]?\s*\d+\s*[,，]\s*\d+\s*[\)）]?",
    r"左侧|右侧|左边|右边|上方|下方|旁边|到我|来我|过来",
    r"\bmove\b",
    r"\bgo to\b",
)

INTERACT_PATTERNS = (
    r"开门",
    r"打开门",
    r"把门打开",
    r"开一下门",
    r"打开\s*door",
    r"\bopen\b.*\bdoor\b",
    r"\binteract\b",
)


def has_state_changing_tool(tool_calls: list[Any] | None) -> bool:
    for call in tool_calls or []:
        if call.get("name") in STATE_CHANGING_TOOLS:
            return True
    return False


def player_requests_move(message: str) -> bool:
    text = (message or "").strip()
    if not text:
        return False
    return any(re.search(p, text, re.IGNORECASE) for p in MOVE_PATTERNS)


def player_requests_interact(message: str) -> bool:
    text = (message or "").strip()
    if not text:
        return False
    return any(re.search(p, text, re.IGNORECASE) for p in INTERACT_PATTERNS)


def player_requests_physical_action(message: str) -> bool:
    return player_requests_move(message) or player_requests_interact(message)


def _player_cell(room: dict[str, Any]) -> tuple[int, int] | None:
    player = room.get("player") or {}
    try:
        return int(player.get("x")), int(player.get("y"))
    except (TypeError, ValueError):
        return None


def _clamp_cell(x: int, y: int, room: dict[str, Any]) -> tuple[int, int]:
    width = int(room.get("width") or 8)
    height = int(room.get("height") or 8)
    max_x = max(0, width - 1)
    max_y = max(0, height - 1)
    return max(0, min(x, max_x)), max(0, min(y, max_y))


def resolve_relative_move_cell(message: str, room: dict[str, Any]) -> tuple[int, int] | None:
    """Deterministic NL relative move when LLM omits move tool (C-01 anchor = state.player)."""
    text = (message or "").strip()
    if not text or not player_requests_move(text):
        return None
    if EXPLICIT_COORD_PATTERN.search(text):
        return None

    anchor = _player_cell(room)
    if anchor is None:
        return None
    px, py = anchor

    if re.search(r"下方|下面|下边", text, re.IGNORECASE):
        return _clamp_cell(px, py + 1, room)
    if re.search(r"上方|上面|上边", text, re.IGNORECASE):
        return _clamp_cell(px, py - 1, room)
    if re.search(r"左侧|左边|左方", text, re.IGNORECASE):
        return _clamp_cell(px - 1, py, room)
    if re.search(r"右侧|右边|右方", text, re.IGNORECASE):
        return _clamp_cell(px + 1, py, room)
    if re.search(r"到我|来我|过来|旁边|我这边|我这边儿", text, re.IGNORECASE):
        # Target initiator cell; game-server snapNpcMoveDest + moveAnchorCell picks a free neighbor.
        return _clamp_cell(px, py, room)

    return None


def inject_relative_move_tool(
    tool_calls: list[dict[str, Any]] | None,
    *,
    player_message: str,
    room: dict[str, Any],
) -> list[dict[str, Any]]:
    if has_state_changing_tool(tool_calls):
        return list(tool_calls or [])
    target = resolve_relative_move_cell(player_message, room)
    if target is None:
        return list(tool_calls or [])
    x, y = target
    injected = {"name": "move", "args": {"type": "move", "x": x, "y": y}}
    return [injected, *(tool_calls or [])]


def build_tool_retry_message(room: dict[str, Any]) -> str:
    width = int(room.get("width") or 8)
    height = int(room.get("height") or 8)
    max_x = max(0, width - 1)
    max_y = max(0, height - 1)
    objects = room.get("objects") or []
    object_lines = [
        f"- {obj.get('id')} ({obj.get('kind')}) @ ({obj.get('x')},{obj.get('y')}) state={obj.get('state')}"
        for obj in objects
        if obj.get("id")
    ]
    objects_text = "\n".join(object_lines) if object_lines else "- door-1 (door) @ (3,3) state=closed"
    return (
        "[系统] 玩家要求执行房间内的物理动作，但你尚未调用 move / interact / wait 工具。\n"
        f"合法坐标：x、y 均为 0 到 {max_x}（当前房间 {width}×{height}）。\n"
        f"已知对象：\n{objects_text}\n"
        "开门必须调用 interact，objectId 使用上表 id（如 door-1）。移动必须调用 move。\n"
        "请在本轮立即调用所需工具，不要只用文字承诺「我会去…」。"
    )
