import re
from typing import Any

STATE_CHANGING_TOOLS = frozenset({"move", "interact", "wait"})

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
