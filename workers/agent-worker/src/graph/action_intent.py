import re
from typing import Any

STATE_CHANGING_TOOLS = frozenset({"move", "interact", "wait"})

EXPLICIT_COORD_PATTERN = re.compile(
    r"[\(（]\s*(\d+)\s*[,，]\s*(\d+)\s*[\)）]",
)

# Player wants the spoken-to NPC to come to them (not «go to another NPC»).
_PLAYER_SUMMON_RE = re.compile(
    r"来这边|这边(儿)?|来一趟|过来一趟|到我|来我|过来|你来|你来不|叫你来|来一下",
    re.IGNORECASE,
)

MOVE_PATTERNS = (
    r"移动",
    r"走到",
    r"走去",
    r"走一步",
    r"向[左右上下]",
    r"去\s*[\(（]?\s*\d+\s*[,，]\s*\d+\s*[\)）]?",
    r"左侧|右侧|左边|右边|上方|下方|下面|下边|旁边|附近|旁白|到我|来我|过来",
    r"来这边|这边(儿)?|来一趟|过来一趟|来一下|叫你来|让你来|你来|你来不",
    r"找你有事|有事找|有事情找|事情找|传话|叫你去|你去不|你去吗|去不去|你去一趟|你去一下",
    r"(?<![有])找你|找一下",
    r"麻烦.{0,6}去",
    r"您去一下",
    r"(去|到|往).{0,8}(那边|那里|那儿)",
    r"(可以去|过去).{0,12}(那边|那里|那儿)",
    r"(那边|那里|那儿).{0,16}(你去|去不|走去|过去|去吗)",
    r"过去",
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


def _player_summons_npc(message: str) -> bool:
    return bool(_PLAYER_SUMMON_RE.search((message or "").strip()))


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


def build_dialogue_context(
    player_message: str,
    recent_turns: list[dict[str, str]] | None = None,
) -> str:
    parts: list[str] = []
    for turn in recent_turns or []:
        text = (turn.get("text") or "").strip()
        if text:
            parts.append(text)
    current = (player_message or "").strip()
    if current:
        parts.append(current)
    return "\n".join(parts)


def _npc_named_in_message(message: str, room: dict[str, Any]) -> dict[str, Any] | None:
    """Single NPC unambiguously referenced by display name in the player message."""
    text = (message or "").strip()
    if not text:
        return None
    matches: list[dict[str, Any]] = []
    for npc in room.get("npcs") or []:
        name = (npc.get("name") or "").strip()
        if len(name) >= 2 and name in text:
            matches.append(npc)
    if not matches:
        return None
    if len(matches) == 1:
        return matches[0]
    matches.sort(key=lambda n: len(str(n.get("name") or "")), reverse=True)
    return matches[0]


def _npc_anchor_from_message(
    message: str,
    room: dict[str, Any],
    dialogue_context: str = "",
) -> dict[str, Any] | None:
    anchor = _npc_named_in_message(message, room)
    if anchor is not None:
        return anchor
    text = (message or "").strip()
    if not text or not re.search(r"她|他|它", text):
        return None
    context = (dialogue_context or "").strip()
    if not context:
        return None
    return _npc_named_in_message(context, room)


def resolve_npc_snap_anchor_cell(
    message: str,
    room: dict[str, Any],
    dialogue_context: str = "",
) -> tuple[int, int] | None:
    """NPC cell for server snap when move intent is relative to another NPC."""
    text = (message or "").strip()
    if not text or not player_requests_move(text):
        return None
    if EXPLICIT_COORD_PATTERN.search(text):
        return None
    if _player_summons_npc(text):
        return None
    anchor_npc = _npc_anchor_from_message(text, room, dialogue_context)
    if anchor_npc is None:
        return None
    try:
        return int(anchor_npc["x"]), int(anchor_npc["y"])
    except (TypeError, ValueError, KeyError):
        return None


def resolve_npc_relative_move_cell(
    message: str,
    room: dict[str, Any],
    dialogue_context: str = "",
) -> tuple[int, int] | None:
    """Resolve move target relative to another NPC named in the message (e.g. 费雪下方)."""
    text = (message or "").strip()
    if not text or not player_requests_move(text):
        return None
    if EXPLICIT_COORD_PATTERN.search(text):
        return None
    # 「来这边/过来/你来」→ player anchor (resolve_relative_move_cell)
    if _player_summons_npc(text):
        return None

    anchor_npc = _npc_anchor_from_message(text, room, dialogue_context)
    if anchor_npc is None:
        return None
    try:
        nx, ny = int(anchor_npc["x"]), int(anchor_npc["y"])
    except (TypeError, ValueError, KeyError):
        return None

    if re.search(r"下方|下面|下边", text, re.IGNORECASE):
        return _clamp_cell(nx, ny + 1, room)
    if re.search(r"上方|上面|上边", text, re.IGNORECASE):
        return _clamp_cell(nx, ny - 1, room)
    if re.search(r"左侧|左边|左方", text, re.IGNORECASE):
        return _clamp_cell(nx - 1, ny, room)
    if re.search(r"右侧|右边|右方", text, re.IGNORECASE):
        return _clamp_cell(nx + 1, ny, room)
    if re.search(
        r"旁边|附近|旁白|那边|那里|那儿|去找|去找她|去找他|找你有事|有事找|传话|叫你去|(?<![有])找你|找一下",
        text,
        re.IGNORECASE,
    ):
        return _clamp_cell(nx, ny, room)
    return None


def resolve_injected_move_cell(
    message: str,
    room: dict[str, Any],
    dialogue_context: str = "",
) -> tuple[int, int] | None:
    """Priority: explicit (x,y) → other-NPC-relative → player-relative."""
    return (
        resolve_explicit_move_cell(message, room)
        or resolve_npc_relative_move_cell(message, room, dialogue_context)
        or resolve_relative_move_cell(message, room)
    )


def resolve_explicit_move_cell(message: str, room: dict[str, Any]) -> tuple[int, int] | None:
    """Parse (x,y) from player message — full destination for move tool."""
    text = (message or "").strip()
    if not text:
        return None
    match = EXPLICIT_COORD_PATTERN.search(text)
    if not match:
        return None
    try:
        x, y = int(match.group(1)), int(match.group(2))
    except (TypeError, ValueError):
        return None
    return _clamp_cell(x, y, room)


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
    if re.search(
        r"到我|来我|过来|旁边|我这边|我这边儿|来这边|这边(儿)?|来一趟|过来一趟|你来|你来不|叫你来|来一下|过去",
        text,
        re.IGNORECASE,
    ):
        # Target initiator cell; game-server snapNpcMoveDest + moveAnchorCell picks a free neighbor.
        return _clamp_cell(px, py, room)

    return None


def align_move_tool_to_intended_target(
    tool_calls: list[dict[str, Any]] | None,
    *,
    player_message: str,
    room: dict[str, Any],
    dialogue_context: str = "",
) -> list[dict[str, Any]]:
    """Override LLM one-step move when player named explicit coords or another NPC-relative target."""
    target = resolve_explicit_move_cell(player_message, room) or resolve_npc_relative_move_cell(
        player_message,
        room,
        dialogue_context,
    )
    if target is None:
        return list(tool_calls or [])
    tx, ty = target
    aligned: list[dict[str, Any]] = []
    for call in tool_calls or []:
        if call.get("name") != "move":
            aligned.append(call)
            continue
        args = {**(call.get("args") or {}), "type": "move", "x": tx, "y": ty}
        aligned.append({**call, "args": args})
    return aligned


def align_move_tool_to_explicit_coords(
    tool_calls: list[dict[str, Any]] | None,
    *,
    player_message: str,
    room: dict[str, Any],
) -> list[dict[str, Any]]:
    """When player names (x,y), override LLM one-step move with full destination."""
    return align_move_tool_to_intended_target(
        tool_calls,
        player_message=player_message,
        room=room,
    )


def inject_relative_move_tool(
    tool_calls: list[dict[str, Any]] | None,
    *,
    player_message: str,
    room: dict[str, Any],
    dialogue_context: str = "",
) -> list[dict[str, Any]]:
    base = list(tool_calls or [])
    if not has_state_changing_tool(base):
        target = resolve_injected_move_cell(player_message, room, dialogue_context)
        if target is None:
            return base
        x, y = target
        injected = {"name": "move", "args": {"type": "move", "x": x, "y": y}}
        return [injected, *base]
    return align_move_tool_to_intended_target(
        base,
        player_message=player_message,
        room=room,
        dialogue_context=dialogue_context,
    )


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
    objects_text = "\n".join(object_lines) if object_lines else "（当前无已知交互物）"
    return (
        "[系统] 玩家要求执行房间内的物理动作，但你尚未调用 move / interact / wait 工具。\n"
        f"合法坐标：x、y 均为 0 到 {max_x}（当前房间 {width}×{height}）。\n"
        f"已知对象：\n{objects_text}\n"
        "交互必须调用 interact，objectId 使用上表 id。移动必须调用 move。\n"
        "请在本轮立即调用所需工具，不要只用文字承诺「我会去…」。"
    )
