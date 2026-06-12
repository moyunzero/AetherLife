"""Safe JSON parsing for game-server HTTP responses."""

import json
from typing import Any

import httpx


def safe_response_json(
    res: httpx.Response,
    *,
    default: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Parse response body as JSON; empty or invalid body returns *default* (or {})."""
    fallback = default if default is not None else {}

    json_fn = getattr(res, "json", None)
    if callable(json_fn):
        try:
            payload = json_fn()
            return payload if isinstance(payload, dict) else fallback
        except ValueError:
            pass

    text_attr = getattr(res, "text", None)
    if text_attr is not None:
        text = (text_attr or "").strip()
        if not text:
            return fallback
        try:
            payload = json.loads(text)
        except ValueError:
            return fallback
        return payload if isinstance(payload, dict) else fallback

    return fallback
