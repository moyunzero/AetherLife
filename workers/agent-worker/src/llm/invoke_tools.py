"""Safe invoke for tool-bound chat models (empty tool arguments from some providers)."""

import json
from typing import Any


def _unwrap_bound_llm(llm: Any) -> Any:
    current = llm
    seen: set[int] = set()
    while hasattr(current, "bound"):
        obj_id = id(current)
        if obj_id in seen:
            break
        seen.add(obj_id)
        current = current.bound
    return current


def is_empty_tool_args_json_error(exc: BaseException) -> bool:
    if isinstance(exc, json.JSONDecodeError):
        return True
    cause = exc.__cause__
    if isinstance(cause, json.JSONDecodeError):
        return True
    text = str(exc)
    return "Expecting value" in text and "char 0" in text


def invoke_tool_bound_llm(llm: Any, messages: list[Any]) -> Any:
    """Invoke a bind_tools LLM; fall back to unbound model when tool args JSON is empty."""
    try:
        return llm.invoke(messages)
    except Exception as exc:
        if not is_empty_tool_args_json_error(exc):
            raise
    return _unwrap_bound_llm(llm).invoke(messages)


# Back-compat alias for internal/tests
_is_empty_tool_args_json_error = is_empty_tool_args_json_error
