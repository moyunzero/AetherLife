"""Deterministic recall merge for PLAY-03 — factual answers without meta callback phrasing."""

from __future__ import annotations

import re
from typing import Any

_RECALL_MARKERS = (
    "记得",
    "还记得",
    "多少",
    "是什么",
    "是啥",
    "之前",
    "上次",
    "刚才",
    "告诉",
    "说过",
    "提过",
)
_REFUSAL_MARKERS = ("自重", "不信任", "不便透露", "无可奉告", "不能告诉", "不会告诉")
_ROLE_PREFIX = re.compile(r"^(?:player|npc)\s*:\s*", re.IGNORECASE)
_PASSWORD_ANS_RE = re.compile(r"密码(?:是|为)?\s*([^\s。，,.!?；;]+)", re.IGNORECASE)
_META_CALLBACK_RE = re.compile(r"你(?:上次|之前|刚才)(?:说|告诉|提过)")

DEFAULT_RECALL_MIN_SCORE = 0.35


def is_recall_question(message: str) -> bool:
    msg = message.strip()
    if not msg:
        return False
    return any(marker in msg for marker in _RECALL_MARKERS)


def best_retrieved_memory(
    retrieved_memories: list[dict[str, Any]] | None,
    *,
    min_score: float = DEFAULT_RECALL_MIN_SCORE,
) -> dict[str, Any] | None:
    items = retrieved_memories or []
    if not items:
        return None
    best = max(items, key=lambda item: float(item.get("score") or 0))
    if float(best.get("score") or 0) < min_score:
        return None
    return best


def _strip_role_prefix(text: str) -> str:
    return _ROLE_PREFIX.sub("", text.strip()).strip()


def extract_password_answer(memory_text: str) -> str | None:
    match = _PASSWORD_ANS_RE.search(memory_text)
    if not match:
        return None
    answer = match.group(1).strip().rstrip("。，,.!?；;")
    return answer or None


def _seed_tokens(message: str, memory_text: str) -> list[str]:
    tokens: list[str] = []
    for source in (message, memory_text):
        for match in re.finditer(r"[A-Z][A-Z0-9_-]{4,}", source):
            token = match.group(0)
            if token not in tokens:
                tokens.append(token)
    return tokens


def reply_covers_recall(
    reply: str,
    *,
    player_message: str,
    memory_text: str,
) -> bool:
    hay = reply.strip()
    if not hay:
        return False
    pwd = extract_password_answer(memory_text)
    if pwd and "密码" in player_message and pwd in hay:
        return True
    for token in _seed_tokens(player_message, memory_text):
        if token in hay:
            return True
    if pwd and pwd in hay:
        return True
    return False


def reply_refuses_recall(reply: str) -> bool:
    return any(marker in reply for marker in _REFUSAL_MARKERS)


def format_recall_answer(player_message: str, memory_text: str) -> str | None:
    """Short in-character fact — no 「你上次说过」 meta phrasing."""
    pwd = extract_password_answer(memory_text)
    if pwd and "密码" in player_message:
        return f"门禁密码是 {pwd}。"
    if pwd:
        return f"{pwd}。"
    for token in _seed_tokens(player_message, memory_text):
        if token in memory_text:
            return f"{token}。"
    return None


def merge_recall_into_reply(
    player_message: str,
    reply: str,
    retrieved_memories: list[dict[str, Any]] | None,
    *,
    min_score: float = DEFAULT_RECALL_MIN_SCORE,
) -> str:
    if not is_recall_question(player_message):
        return reply
    best = best_retrieved_memory(retrieved_memories, min_score=min_score)
    if best is None:
        return reply
    memory_text = _strip_role_prefix(str(best.get("text") or best.get("content") or ""))
    if not memory_text:
        return reply
    draft = (reply or "").strip()
    if reply_covers_recall(draft, player_message=player_message, memory_text=memory_text):
        return _META_CALLBACK_RE.sub("", draft).strip() or draft
    if reply_refuses_recall(draft):
        draft = ""
    fact = format_recall_answer(player_message, memory_text)
    if not fact:
        return reply
    if not draft:
        return fact
    return f"{draft} {fact}".strip()
