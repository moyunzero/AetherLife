"""Gateway output guard — mirrors worker reply_audit patterns."""

from __future__ import annotations

import re
from typing import Any

FALLBACK_REPLY = "我还不能确定能否那样做——让我先试着与房间互动。"

STATE_CHANGE_PATTERNS = [
    re.compile(r"\b(opened|closed|moved|picked up|picked|walked|went to|entered|left)\b", re.I),
    re.compile(r"(打开了|关闭了|移动到|走向|拿起了|捡起了|去把门打开|就去打开|把门打开|我现在就去)", re.I),
]

STATE_CHANGING_TOOLS = frozenset({"move", "interact", "transfer", "wait"})


def _has_state_changing_tool(tool_calls: list[Any] | None) -> bool:
    if not tool_calls:
        return False
    for tc in tool_calls:
        name = None
        if isinstance(tc, dict):
            name = tc.get("name") or (tc.get("function") or {}).get("name")
        else:
            name = getattr(tc, "name", None)
        if name and str(name).lower() in STATE_CHANGING_TOOLS:
            return True
    return False


def audit_reply(text: str, tool_calls: list[Any] | None = None) -> str:
    if _has_state_changing_tool(tool_calls):
        return text
    for pattern in STATE_CHANGE_PATTERNS:
        if pattern.search(text):
            return FALLBACK_REPLY
    return text
