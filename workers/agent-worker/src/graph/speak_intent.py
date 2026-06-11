"""Rule-based speak intent router — classifies player message before LLM/RAG."""

from __future__ import annotations

import re
from enum import Enum
from typing import TYPE_CHECKING, Any

from src.collective.social_turn import infer_social_from_message

if TYPE_CHECKING:
    from src.collective.schemas import SocialTurnOut
from src.graph.action_intent import player_requests_physical_action
from src.graph.recall_merge import _RECALL_MARKERS, is_recall_question

_CASUAL_GREETING_ONLY_RE = re.compile(
    r"^(你好(呀|啊|哦|呐|呢)?|嗨(呀|啊)?|hello|hi|hey|早上好|晚上好|下午好|在吗|在不在)([～!！?？。…]*)?$",
    re.IGNORECASE,
)
_META_BRIEF_RE = re.compile(r"简短|一句话|别太长|简单说说|简单说")
_NARRATIVE_MARKERS = (
    "哪里",
    "为什么",
    "怎么",
    "讲讲",
    "历史",
    "世界",
    "故事",
    "是什么",
    "做什么",
    "在干嘛",
    "干什么",
    "在忙",
)


class SpeakIntent(str, Enum):
    CASUAL = "casual"
    PHYSICAL = "physical"
    RECALL = "recall"
    SOCIAL_EDGE = "social_edge"
    NARRATIVE = "narrative"


def is_casual_greeting_only(message: str) -> bool:
    """
    Detect whether the input is solely a casual greeting in Chinese or English.
    
    Parameters:
        message (str | None): The text to check; None is treated as an empty string and leading/trailing whitespace is ignored.
    
    Returns:
        bool: `True` if the trimmed message is a non-empty greeting-only phrase (e.g., "hi", "hello", "你好") optionally followed by punctuation, `False` otherwise.
    """
    msg = (message or "").strip()
    return bool(msg and _CASUAL_GREETING_ONLY_RE.match(msg))


def classify_speak_intent(
    message: str,
    recent_turns: list | None = None,
) -> SpeakIntent:
    """
    Classify a player message into a SpeakIntent using a fixed priority of heuristics.
    
    Classification priority (first match wins): PHYSICAL → RECALL → SOCIAL_EDGE → CASUAL → NARRATIVE.
    Empty or whitespace-only messages are treated as NARRATIVE.
    
    Parameters:
        recent_turns (list | None): Reserved for future context-aware routing; currently ignored.
    
    Returns:
        SpeakIntent: The routing category for the provided message (one of PHYSICAL, RECALL, SOCIAL_EDGE, CASUAL, NARRATIVE).
    """
    del recent_turns  # reserved for future context-aware routing
    msg = (message or "").strip()
    if not msg:
        return SpeakIntent.NARRATIVE
    if player_requests_physical_action(msg):
        return SpeakIntent.PHYSICAL
    if is_recall_question(msg):
        return SpeakIntent.RECALL
    if infer_social_from_message(msg) is not None:
        return SpeakIntent.SOCIAL_EDGE
    if is_casual_greeting_only(msg):
        return SpeakIntent.CASUAL
    if _META_BRIEF_RE.search(msg):
        return SpeakIntent.CASUAL
    if any(marker in msg for marker in _NARRATIVE_MARKERS):
        return SpeakIntent.NARRATIVE
    return SpeakIntent.NARRATIVE


def should_skip_memory_context(intent: SpeakIntent) -> bool:
    """
    Determine whether to skip memory context for the given speak intent.
    
    Returns:
        `true` if the intent is `PHYSICAL` or `CASUAL`, `false` otherwise.
    """
    return intent in (SpeakIntent.PHYSICAL, SpeakIntent.CASUAL)


def should_skip_memory_embed(intent: SpeakIntent) -> bool:
    """
    Indicates whether memory embedding should be skipped for the given speak intent.
    
    Returns:
        True if intent is `SpeakIntent.CASUAL`, False otherwise.
    """
    return intent == SpeakIntent.CASUAL


def can_use_casual_fast_lane(
    player_message: str,
    recent_turns: list | None = None,
) -> tuple[SpeakIntent, Any | None]:
    """
    Attempt to produce a deterministic social turn for casual player messages to enable the casual fast lane.
    
    Parameters:
        player_message (str): The player's message to classify and potentially convert into a deterministic social turn.
        recent_turns (list | None): Optional recent dialogue turns (currently accepted but not used).
    
    Returns:
        tuple[SpeakIntent, Any | None]: A tuple (intent, turn) where `intent` is the classified SpeakIntent and `turn` is a `SocialTurnOut` instance when a deterministic casual social turn was produced, or `None` if no casual fast-lane turn is available.
    """
    from src.graph.nodes.llm_social_turn import _deterministic_social_turn

    intent = classify_speak_intent(player_message, recent_turns)
    if intent != SpeakIntent.CASUAL:
        return intent, None
    turn: SocialTurnOut | None = _deterministic_social_turn(
        player_message,
        speak_intent=intent.value,
    )
    if turn is None:
        return intent, None
    return intent, turn
