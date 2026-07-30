import re
from typing import Any

from src.graph.action_intent import has_state_changing_tool

# Claimed completed/imminent physical acts — keep narrow to avoid chat false positives
# (e.g. English "I'm moved", "I've left that behind"; Chinese "我现在就去告诉你").
STATE_CHANGE_PATTERNS = [
    r"\b(opened|closed|picked up|walked|went to|entered|moved to)\b",
    r"(打开了|关闭了|移动到|走向了|走向门|拿起了|捡起了|去把门打开|就去打开|把门打开|我现在就去(?:把门|打开|拿|捡|走|过去))",
]

FALLBACK_REPLY = "抱歉，我这边还做不到。"


def audit_reply(text: str, tool_calls: list[Any] | None) -> str:
    if has_state_changing_tool(tool_calls):
        return text
    for pattern in STATE_CHANGE_PATTERNS:
        if re.search(pattern, text, re.IGNORECASE):
            return FALLBACK_REPLY
    return text
