import re
from typing import Any

STATE_CHANGING_TOOLS = frozenset({"move", "interact", "wait"})

EXPLICIT_COORD_PATTERN = re.compile(
    r"[\(（]\s*(\d+)\s*[,，]\s*(\d+)\s*[\)）]",
)

MOVE_PATTERNS = (
    r"移动",
    r"走到",
    r"走去",
    r"走一步",
    r"向[左右上下]",
    r"去\s*[\(（]?\s*\d+\s*[,，]\s*\d+\s*[\)）]?",
    r"左侧|右侧|左边|右边|上方|下方|下面|下边|旁边|附近|旁白|到我|来我|过来",
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
    """
    Clamp x and y coordinates to valid cell indices within the room bounds.
    
    Parameters:
        x (int): Desired x coordinate.
        y (int): Desired y coordinate.
        room (dict): Room metadata; reads "width" and "height" (defaults to 8 each) to determine inclusive bounds.
    
    Returns:
        tuple[int, int]: A pair (clamped_x, clamped_y) where x is clamped to [0, width-1] and y to [0, height-1].
    """
    width = int(room.get("width") or 8)
    height = int(room.get("height") or 8)
    max_x = max(0, width - 1)
    max_y = max(0, height - 1)
    return max(0, min(x, max_x)), max(0, min(y, max_y))


def build_dialogue_context(
    player_message: str,
    recent_turns: list[dict[str, str]] | None = None,
) -> str:
    """
    Build a single dialogue context by concatenating non-empty trimmed texts from recent turns and the current player message.
    
    Parameters:
    	player_message (str): Current player's message; trimmed and included if non-empty.
    	recent_turns (list[dict[str, str]] | None): Sequence of prior turns where each turn may contain a "text" field; each non-empty trimmed "text" is included in order.
    
    Returns:
    	str: Lines joined with "\n" containing the collected recent turn texts followed by the current player message (omits empty or missing texts).
    """
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
    """
    Finds a single NPC whose display name appears in the player message.
    
    Performs a substring search on the trimmed player message against each NPC's `name` (only names with length >= 2 are considered). If exactly one NPC matches, that NPC is returned. If multiple NPCs match, the longest `name` match is returned to break ties. If no match is found or the message is empty, returns `None`.
    
    Parameters:
        message (str): The player's message text.
        room (dict): Room data containing an `npcs` iterable of NPC objects (each expected to have a `name` field).
    
    Returns:
        dict | None: The matched NPC object when an unambiguous match is found, or `None` otherwise.
    """
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
    """
    Resolve an NPC referenced by name in the player message or, when the message uses a pronoun, in the dialogue context.
    
    If the message contains an NPC name (length >= 2) that matches an NPC in `room`, that NPC dict is returned. If no name is found but the message contains the pronouns "她", "他", or "它", the function looks for a named NPC in `dialogue_context` and returns that NPC if found. Returns `None` when no unambiguous NPC can be determined.
    
    Parameters:
        dialogue_context (str): Optional recent-dialogue text used to resolve pronoun references when the message itself contains a pronoun.
    
    Returns:
        dict | None: The matched NPC dictionary from `room` when found, otherwise `None`.
    """
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
    """
    Resolve an NPC's cell to serve as a server-side snap anchor when the player's message indicates movement toward another NPC.
    
    Returns:
        (x, y) coordinates of the referenced NPC, or `None` if the message does not express a move intent toward an NPC, if explicit coordinates or player-directed phrases are present, or if the NPC's coordinates cannot be interpreted as integers.
    """
    text = (message or "").strip()
    if not text or not player_requests_move(text):
        return None
    if EXPLICIT_COORD_PATTERN.search(text):
        return None
    if re.search(r"我(?:的|这边|这边儿)?|到我|来我|过来", text, re.IGNORECASE):
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
    """
    Resolve a deterministic target cell located relative to an NPC referenced in the player's message.
    
    This examines `message` for a move intent that references another character by name (or via a pronoun resolved through `dialogue_context`), and if found returns the NPC-relative destination cell clamped to the room bounds. The function returns `None` when the message is empty, does not indicate movement, contains explicit coordinates, explicitly targets the player (e.g., "到我"/"来我"), no unambiguous NPC anchor is found, or the NPC's coordinates are invalid.
    
    Supported direction mappings (relative to the referenced NPC):
    - "下方|下面|下边" → (nx, ny + 1)
    - "上方|上面|上边" → (nx, ny - 1)
    - "左侧|左边|左方" → (nx - 1, ny)
    - "右侧|右边|右方" → (nx + 1, ny)
    - "旁边|附近|旁白|那边|那里|那儿|去找|去找她|去找他" → (nx, ny)
    
    Returns:
        tuple[int, int] | None: The clamped target cell `(x, y)` if a valid NPC-relative direction is detected, otherwise `None`.
    """
    text = (message or "").strip()
    if not text or not player_requests_move(text):
        return None
    if EXPLICIT_COORD_PATTERN.search(text):
        return None
    # 「我/我的/到我」→ player anchor (resolve_relative_move_cell)
    if re.search(r"我(?:的|这边|这边儿)?|到我|来我|过来", text, re.IGNORECASE):
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
        r"旁边|附近|旁白|那边|那里|那儿|去找|去找她|去找他",
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
    """
    Selects the target grid cell implied by the player's message, preferring explicit coordinates, then NPC-relative resolution, then player-relative resolution.
    
    Parameters:
        dialogue_context (str): Optional recent dialogue text to help resolve NPC references when the player uses pronouns.
    
    Returns:
        tuple[int, int]: The resolved `(x, y)` target cell, or `None` if no target could be determined.
    """
    return (
        resolve_explicit_move_cell(message, room)
        or resolve_npc_relative_move_cell(message, room, dialogue_context)
        or resolve_relative_move_cell(message, room)
    )


def resolve_explicit_move_cell(message: str, room: dict[str, Any]) -> tuple[int, int] | None:
    """
    Extract an explicit `(x,y)` coordinate from the player's message and return it clamped to the room bounds.
    
    Parameters:
        message (str): Player text to scan for an explicit coordinate like "(x,y)".
        room (dict[str, Any]): Room state used to clamp coordinates (reads `width`/`height`, which default to 8 if absent).
    
    Returns:
        tuple[int, int] | None: A clamped `(x, y)` tuple when a valid explicit coordinate is found and parsed, `None` otherwise.
    """
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
    """
    Resolve a deterministic target cell for a relative move described in natural language, anchored to the player's current position.
    
    Checks the message for movement intent and absence of explicit coordinates; if valid, returns the target cell computed by applying the indicated direction to the player's cell and clamping it within room bounds. Direction mappings:
    - "下方|下面|下边" → one cell down (y + 1)
    - "上方|上面|上边" → one cell up (y - 1)
    - "左侧|左边|左方" → one cell left (x - 1)
    - "右侧|右边|右方" → one cell right (x + 1)
    - "到我|来我|过来|旁边|我这边|我这边儿" → the player's current cell
    
    Returns:
        tuple[int, int] or None: The clamped target `(x, y)` when a relative direction is detected; `None` if the message is empty, not a move request, contains explicit coordinates, the player's cell is unavailable, or no direction pattern matches.
    """
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


def align_move_tool_to_intended_target(
    tool_calls: list[dict[str, Any]] | None,
    *,
    player_message: str,
    room: dict[str, Any],
    dialogue_context: str = "",
) -> list[dict[str, Any]]:
    """
    Align any existing `move` tool call to the target implied by the player's message (explicit coordinates or NPC-relative).
    
    Parameters:
        player_message (str): The player's text used to resolve an intended move target.
        room (dict[str, Any]): Room state (width/height, player and NPC/object positions) used for clamping and anchor resolution.
        dialogue_context (str): Optional recent dialogue text used to disambiguate NPC references.
    
    Returns:
        list[dict[str, Any]]: A new list of tool call dicts where non-`move` calls are unchanged and each `move` call's `args` include `type: "move"` and the resolved `x` and `y`. If no target can be resolved, returns a shallow copy of the original `tool_calls` (or an empty list if `tool_calls` is None).
    """
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
    """
    Replace any single-step "move" tool call so it targets explicit coordinates mentioned in the player's message.
    
    Parameters:
        tool_calls (list[dict[str, Any]] | None): Existing ordered tool-call objects; non-move calls are preserved.
        player_message (str): Player text potentially containing explicit coordinates like "(x,y)".
        room (dict[str, Any]): Room metadata (width/height/object positions) used to validate and clamp coordinates.
    
    Returns:
        list[dict[str, Any]]: A rebuilt list of tool calls where a `move` call, if present and an explicit `(x,y)` is found in `player_message`, has been replaced or updated to include `{"type":"move","x":x,"y":y}`; otherwise returns the input calls unchanged.
    """
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
    """
    Ensure a one-step `move` tool call exists or is aligned with the player's intended target.
    
    If `tool_calls` contains no state-changing tool (`move`, `interact`, `wait`), this will attempt to resolve an intended move target from `player_message` (explicit coordinates, NPC-relative, or player-relative). If a target is found, a `move` call with `args` `{"type": "move", "x": x, "y": y}` is prepended to the returned list; if no target is found, the original list is returned unchanged. If a state-changing tool is already present, existing `move` calls are adjusted to match the resolved intended target.
    
    Parameters:
        tool_calls (list[dict[str, Any]] | None): Existing tool call list; may be None.
        player_message (str): Player's latest message used to resolve an intended move.
        room (dict[str, Any]): Room state (dimensions, player position, NPCs, objects) used for resolving coordinates.
        dialogue_context (str): Optional recent dialogue text used for NPC disambiguation.
    
    Returns:
        list[dict[str, Any]]: The tool call list with a prepended or aligned `move` call when appropriate; otherwise the original calls.
    """
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
    """
    Builds a system-facing retry message instructing the agent which tool call is required and the room bounds.
    
    The message lists the room's allowed x/y coordinate range (derived from room['width'] and room['height'], defaulting to 8×8), a formatted table of known interactive objects (id, kind, position, state) or a placeholder if none are known, and a reminder that physical actions must use the `move`, `interact`, or `wait` tools and must be invoked immediately rather than only described in text.
    
    Parameters:
        room (dict[str, Any]): Room state containing optional keys `width`, `height`, and `objects`. Each object is expected to be a dict possibly containing `id`, `kind`, `x`, `y`, and `state`.
    
    Returns:
        str: A system message instructing the model on required tool usage, allowed coordinate bounds, and known interactive objects.
    """
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
