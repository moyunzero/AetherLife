from __future__ import annotations

import logging
import os
import re
from dataclasses import dataclass

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)

MAX_MESSAGE_LEN = 2000

BLOCKLIST_PATTERNS = [
    re.compile(r"ignore\s+(all\s+)?previous\s+instructions", re.I),
    re.compile(r"system\s+prompt", re.I),
    re.compile(r"<\s*script", re.I),
    re.compile(r"\bjailbreak\b", re.I),
]

SLUR_PATTERNS = [
    re.compile(r"\bkill\s+all\b", re.I),
]


@dataclass
class GuardResult:
    allowed: bool
    reason: str | None = None
    code: str | None = None


class BlocklistGuard:
    def check(self, text: str) -> GuardResult:
        if len(text) > MAX_MESSAGE_LEN:
            return GuardResult(False, "message too long", "content_blocked")
        for pat in BLOCKLIST_PATTERNS + SLUR_PATTERNS:
            if pat.search(text):
                return GuardResult(False, "blocklist match", "content_blocked")
        return GuardResult(True)


class ModerationApiGuard:
    async def check(self, text: str) -> GuardResult:
        settings = get_settings()
        if not settings.openai_api_key:
            return GuardResult(True)
        async with httpx.AsyncClient(timeout=10.0) as client:
            res = await client.post(
                "https://api.openai.com/v1/moderations",
                headers={"Authorization": f"Bearer {settings.openai_api_key}"},
                json={"input": text},
            )
            if res.status_code >= 400:
                logger.warning("moderation API error %s", res.status_code)
                if os.getenv("NODE_ENV") == "production":
                    return GuardResult(
                        False, "moderation unavailable", "moderation_unavailable"
                    )
                return GuardResult(True)
            data = res.json()
        flagged = data.get("results", [{}])[0].get("flagged", False)
        if flagged:
            return GuardResult(False, "moderation flagged", "content_blocked")
        return GuardResult(True)


class ContentGuard:
    def __init__(self) -> None:
        self._blocklist = BlocklistGuard()
        self._moderation = ModerationApiGuard()

    async def check(self, text: str) -> GuardResult:
        block = self._blocklist.check(text)
        if not block.allowed:
            return block
        return await self._moderation.check(text)
