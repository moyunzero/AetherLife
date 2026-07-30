"""Gateway output guard — mirrors worker reply_audit patterns."""

from __future__ import annotations

import re
from typing import Any

FALLBACK_REPLY = "抱歉，我这边还做不到。"

STATE_CHANGE_PATTERNS = [
    re.compile(r"\b(opened|closed|picked up|walked|went to|entered|moved to)\b", re.I),
    re.compile(
        r"(打开了|关闭了|移动到|走向了|走向门|拿起了|捡起了|去把门打开|就去打开|把门打开|我现在就去(?:把门|打开|拿|捡|走|过去))",
        re.I,
    ),
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
