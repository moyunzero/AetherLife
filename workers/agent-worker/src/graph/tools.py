import json
from pathlib import Path
from typing import Any


def tools_json_path() -> Path:
    return (
        Path(__file__).resolve().parents[4]
        / "packages"
        / "game-actions"
        / "dist"
        / "tools.json"
    )


def load_tool_definitions() -> list[dict[str, Any]]:
    path = tools_json_path()
    if not path.is_file():
        raise FileNotFoundError(
            f"Missing tool definitions at {path}; run pnpm --filter @aetherlife/game-actions run export:tools"
        )
    return json.loads(path.read_text(encoding="utf-8"))


def normalize_tool_definition(tool: dict[str, Any]) -> dict[str, Any]:
    """Flatten zod-to-json-schema export quirks for OpenAI tool binding."""
    fn = tool.get("function") or {}
    name = str(fn.get("name") or "")
    params = fn.get("parameters") or {}
    props = params.get("properties") if isinstance(params.get("properties"), dict) else {}
    nested_defs = props.get("definitions") or params.get("definitions")
    if isinstance(nested_defs, dict) and name in nested_defs:
        params = nested_defs[name]
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": fn.get("description", ""),
            "parameters": params,
        },
    }


def load_tools_for_binding() -> list[dict[str, Any]]:
    return [normalize_tool_definition(tool) for tool in load_tool_definitions()]


def parse_tool_calls(message: Any) -> list[dict[str, Any]]:
    parsed: list[dict[str, Any]] = []
    for call in getattr(message, "tool_calls", None) or []:
        if isinstance(call, dict):
            name = call.get("name", "")
            args = call.get("args") or {}
        else:
            name = getattr(call, "name", "")
            args = getattr(call, "args", {}) or {}
        if isinstance(args, str):
            args = json.loads(args)
        if not isinstance(args, dict):
            args = {}
        parsed.append({"name": name, "args": args})
    return parsed


def reply_from_turn(message: Any, tool_calls: list[dict[str, Any]]) -> str:
    for call in tool_calls:
        if call.get("name") == "speak":
            content = (call.get("args") or {}).get("content")
            if content:
                return str(content).strip()

    content = getattr(message, "content", "")
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts: list[str] = []
        for chunk in content:
            if isinstance(chunk, dict) and chunk.get("type") == "text":
                parts.append(str(chunk.get("text") or ""))
        return "".join(parts).strip()
    return str(content or "").strip()
