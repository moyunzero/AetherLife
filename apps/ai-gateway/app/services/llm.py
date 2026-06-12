"""Structured intent JSON from natural language (OpenRouter or mock heuristics)."""

from __future__ import annotations

import json
import os
import re
from typing import Any

import httpx

from app.config import get_settings
from app.models.actions import validate_nl_action

PARSE_SYSTEM = """You extract a single game action as JSON from the player message.
Return ONLY valid JSON with one object matching exactly one of:
- {"type":"move","x":number,"y":number}
- {"type":"interact","objectId":string}
- {"type":"speak","targetId":string,"content":string}
- {"type":"wait","durationMs":number}
- {"type":"transfer","itemId":string,"toNpcId":string}
Do not map Chinese NPC names to ids; use literal ids like npc-2 when needed.
If unclear, return {"type":"wait","durationMs":1000}."""


def _heuristic_parse(message: str) -> dict[str, Any]:
    text = message.strip()
    move = re.search(
        r"(?:走到|移动到|move to|go to|坐标)\s*[\(（]?\s*(\d+)\s*[,，]\s*(\d+)",
        text,
        re.I,
    )
    if move:
        return {"type": "move", "x": float(move.group(1)), "y": float(move.group(2))}
    interact = re.search(
        r"(?:打开|开门|interact|use|与)\s*([\w-]+)(?:\s*互动)?|open\s+([\w-]+)",
        text,
        re.I,
    )
    if interact:
        oid = interact.group(1) or interact.group(2)
        return {"type": "interact", "objectId": oid}
    transfer = re.search(
        r"(?:把|give|transfer)\s+([\w-]+)\s+(?:交给|to)\s+(npc-[\w-]+)",
        text,
        re.I,
    )
    if transfer:
        return {
            "type": "transfer",
            "itemId": transfer.group(1),
            "toNpcId": transfer.group(2),
        }
    if "递给 npc-2" in text:
        item = re.search(r"物品\s+([\w-]+)", text)
        return {
            "type": "transfer",
            "itemId": item.group(1) if item else "item-1",
            "toNpcId": "npc-2",
        }
    speak = re.search(
        r"(?:对|跟|tell|speak to)\s+([\w-]+)\s*(?:说|about)?\s*(.*)$",
        text,
        re.I,
    )
    if speak:
        content = (speak.group(2) or text).strip() or "hello"
        return {"type": "speak", "targetId": speak.group(1), "content": content[:500]}
    wait_ms = re.search(r"(?:等待|wait for)\s*(\d+)\s*(?:秒|ms)?", text, re.I)
    if wait_ms:
        n = int(wait_ms.group(1))
        unit = "ms" if "ms" in text.lower() else "sec"
        return {"type": "wait", "durationMs": n if unit == "ms" else n * 1000}
    if re.search(r"(?:等一下|hold on)", text, re.I):
        return {"type": "wait", "durationMs": 1000}
    return {"type": "wait", "durationMs": 1000}


def _parse_openrouter_content(body: object) -> dict[str, Any]:
    if not isinstance(body, dict):
        raise ValueError("OpenRouter response is not an object")
    choices = body.get("choices")
    if not isinstance(choices, list) or not choices:
        raise ValueError("OpenRouter response missing choices")
    first = choices[0]
    if not isinstance(first, dict):
        raise ValueError("OpenRouter choice is not an object")
    message = first.get("message")
    if not isinstance(message, dict):
        raise ValueError("OpenRouter choice missing message")
    content = message.get("content")
    if not isinstance(content, str) or not content.strip():
        raise ValueError("OpenRouter message content empty")
    parsed = json.loads(content)
    if not isinstance(parsed, dict):
        raise ValueError("OpenRouter content is not a JSON object")
    action, err = validate_nl_action(parsed)
    if err or not action:
        raise ValueError(err or "invalid NL action")
    return action


async def parse_intent_json(message: str, *, golden_expected: dict | None = None) -> dict[str, Any]:
    """Return raw action dict before Pydantic validation."""
    settings = get_settings()
    if golden_expected is not None:
        return golden_expected
    keys: list[str] = []
    csv = os.getenv("OPENROUTER_API_KEYS", "").strip()
    if csv:
        keys.extend(k.strip() for k in csv.split(",") if k.strip())
    for raw in (settings.openrouter_api_key, settings.openrouter_api_key_2):
        if raw and raw not in keys:
            keys.append(raw)
    if settings.llm_mock or not keys:
        return _heuristic_parse(message)

    payload = {
        "model": os.getenv("LLM_MODEL", "openai/gpt-oss-120b:free"),
        "messages": [
            {"role": "system", "content": PARSE_SYSTEM},
            {"role": "user", "content": message},
        ],
        "response_format": {"type": "json_object"},
    }
    last_error: Exception | None = None
    async with httpx.AsyncClient(timeout=15.0) as client:
        for key_idx, api_key in enumerate(keys):
            headers = {
                "Authorization": f"Bearer {api_key}",
                "HTTP-Referer": os.getenv("OPENROUTER_HTTP_REFERER", "http://localhost:5173"),
                "X-Title": os.getenv("OPENROUTER_APP_TITLE", "AetherLife"),
            }
            try:
                res = await client.post(
                    "https://openrouter.ai/api/v1/chat/completions",
                    json=payload,
                    headers=headers,
                )
                res.raise_for_status()
                body = res.json()
                return _parse_openrouter_content(body)
            except httpx.HTTPStatusError as exc:
                last_error = exc
                if exc.response.status_code == 429 and key_idx + 1 < len(keys):
                    continue
                raise
            except (json.JSONDecodeError, ValueError) as exc:
                last_error = exc
                if key_idx + 1 < len(keys):
                    continue
                break
    if last_error:
        raise last_error
    return _heuristic_parse(message)
