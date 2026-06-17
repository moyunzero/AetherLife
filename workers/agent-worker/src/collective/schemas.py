from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator

from .constants import COLLECTIVE_EVENT_KINDS

# Perception-only: skip DB write (not the collective event kind "ignore").
SOCIAL_SKIP_KIND = "ignore"

SocialPerceptionKind = Literal[
    "rude",
    "polite",
    "help",
    "contradict",
    "compete_object",
    "collaborate",
    "steal_attempt",
    "ignore",
    "gift",
    "praise",
    "apologize",
    "betray",
    SOCIAL_SKIP_KIND,
]


class SocialPerception(BaseModel):
    kind: SocialPerceptionKind
    summary: str = Field(max_length=80)
    delta: int = Field(ge=-10, le=10, default=0)

    @field_validator("summary")
    @classmethod
    def strip_summary(cls, value: str) -> str:
        return value.strip()


class SocialTurnOut(BaseModel):
    """reply first — matches streaming prompt order (reply visible before social block)."""

    reply: str = Field(min_length=1)
    social: SocialPerception

    @field_validator("reply")
    @classmethod
    def strip_reply(cls, value: str) -> str:
        text = value.strip()
        if not text:
            raise ValueError("reply must not be empty")
        return text


def is_social_skip(perception: SocialPerception) -> bool:
    return perception.kind == SOCIAL_SKIP_KIND


def is_valid_collective_kind(kind: str) -> bool:
    return kind in COLLECTIVE_EVENT_KINDS
