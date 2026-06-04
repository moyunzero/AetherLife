import re
from typing import Any

from src.graph.action_intent import has_state_changing_tool

STATE_CHANGE_PATTERNS = [
    r"\b(opened|closed|moved|picked up|picked|walked|went to|entered|left)\b",
    r"(打开了|关闭了|移动到|走向|拿起了|捡起了|去把门打开|就去打开|把门打开|我现在就去)",
]

FALLBACK_REPLY = "我还不能确定能否那样做——让我先试着与房间互动。"


def audit_reply(text: str, tool_calls: list[Any] | None) -> str:
    if has_state_changing_tool(tool_calls):
        return text
    for pattern in STATE_CHANGE_PATTERNS:
        if re.search(pattern, text, re.IGNORECASE):
            return FALLBACK_REPLY
    return text
