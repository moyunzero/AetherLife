from __future__ import annotations

import asyncio
import logging

from app.config import get_settings
from app.models.actions import validate_nl_action
from app.services import llm

logger = logging.getLogger(__name__)


async def parse_intent(message: str, *, golden_expected: dict | None = None) -> tuple[dict | None, str | None]:
    settings = get_settings()
    try:
        raw = await asyncio.wait_for(
            llm.parse_intent_json(message, golden_expected=golden_expected),
            timeout=settings.parse_timeout_s,
        )
        parsed, err = validate_nl_action(raw)
        if err:
            return None, err
        return parsed, None
    except asyncio.TimeoutError:
        logger.warning("parse_intent timeout message=%r", message[:80])
        return None, "parse timeout"
    except Exception as exc:
        logger.warning("parse_intent failed: %s", exc)
        return None, str(exc)
