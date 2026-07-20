"""Personal timeline RAG for speak (BIO-09, D-RAG-01) + proposalEligible feed (BIO-07)."""

from __future__ import annotations

import re
import sys
from typing import Any

import httpx

from src.config import Settings

_TIMELINE_FETCH_TIMEOUT_S = 8.0
_MAX_PERSONAL_BULLETS = 2
_BULLET_MAX_LEN = 100
_PARAPHRASE_BODY_LEN = 48

_TOPIC_KEYWORDS = frozenset(
    {
        "议会",
        "廷议",
        "投票",
        "表决",
        "防务",
        "边境",
        "封印",
        "裂隙",
        "同僚",
        "议员",
        "传记",
        "往事",
        "回忆",
        "年少",
        "关系",
        "辩论",
        "落槌",
        "创世",
        "始源",
    }
)


def _game_headers(settings: Settings) -> dict[str, str]:
    headers: dict[str, str] = {"X-Player-Id": "__legacy__"}
    if settings.internal_worker_token:
        headers["Authorization"] = f"Bearer {settings.internal_worker_token}"
    return headers


def _normalize_tokens(text: str) -> set[str]:
    cleaned = re.sub(r"\s+", "", (text or "").lower())
    tokens: set[str] = set()
    for kw in _TOPIC_KEYWORDS:
        if kw in cleaned:
            tokens.add(kw)
    for piece in re.findall(r"[\u4e00-\u9fff]{2,}", cleaned):
        if len(piece) >= 2:
            tokens.add(piece)
    return tokens


def topic_relevant_personal(query: str, entries: list[dict[str, Any]]) -> bool:
    """Lightweight keyword overlap — skip personal RAG when off-topic (D-RAG-01)."""
    q_tokens = _normalize_tokens(query)
    if not q_tokens:
        return False
    corpus_parts: list[str] = []
    for entry in entries:
        corpus_parts.append(str(entry.get("body") or ""))
        corpus_parts.append(str(entry.get("tag") or ""))
        corpus_parts.append(str(entry.get("factualSummary") or ""))
        corpus_parts.append(str(entry.get("calendarLabel") or ""))
    corpus = " ".join(corpus_parts)
    c_tokens = _normalize_tokens(corpus)
    if q_tokens & c_tokens:
        return True
    if q_tokens & _TOPIC_KEYWORDS:
        # Still require some corpus signal so unrelated council chatter doesn't always inject.
        return bool(c_tokens & _TOPIC_KEYWORDS)
    return False


def _truncate(text: str, max_len: int) -> str:
    stripped = (text or "").strip()
    if len(stripped) <= max_len:
        return stripped
    return f"{stripped[: max_len - 1]}…"


def format_personal_timeline_bullet(entry: dict[str, Any]) -> str:
    """Paraphrase bullet — never dump the full first-person body (D-RAG-01 / T-27-17)."""
    body = str(entry.get("body") or "").strip()
    if not body:
        return ""
    tag = str(entry.get("tag") or "daily")
    label = str(entry.get("calendarLabel") or "")
    gist = _truncate(body, _PARAPHRASE_BODY_LEN)
    # Ensure we never equal the raw body when body is long.
    if len(body) > _PARAPHRASE_BODY_LEN and gist == body:
        gist = _truncate(body, _PARAPHRASE_BODY_LEN)
    when = f"（{label}）" if label else ""
    return f"·个人往事[{tag}]{when}：{gist}（意译，勿复读原文）"


def score_entry_for_query(query: str, entry: dict[str, Any]) -> int:
    q_tokens = _normalize_tokens(query)
    if not q_tokens:
        return 0
    blob = " ".join(
        [
            str(entry.get("body") or ""),
            str(entry.get("tag") or ""),
            str(entry.get("factualSummary") or ""),
        ]
    )
    e_tokens = _normalize_tokens(blob)
    return len(q_tokens & e_tokens)


def select_personal_entries(
    query: str,
    entries: list[dict[str, Any]],
    *,
    limit: int = _MAX_PERSONAL_BULLETS,
) -> list[dict[str, Any]]:
    if not topic_relevant_personal(query, entries):
        return []
    ranked = sorted(
        entries,
        key=lambda e: (score_entry_for_query(query, e), int(e.get("seq") or 0)),
        reverse=True,
    )
    selected: list[dict[str, Any]] = []
    for entry in ranked:
        if score_entry_for_query(query, entry) <= 0 and not (
            _normalize_tokens(str(entry.get("body") or "")) & _TOPIC_KEYWORDS
        ):
            continue
        selected.append(entry)
        if len(selected) >= limit:
            break
    return selected


def filter_proposal_eligible_entries(entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """BIO-07 read-only filter — no mutation of world_history."""
    return [e for e in entries if e.get("proposalEligible") is True]


def fetch_personal_timeline_entries(
    client: httpx.Client,
    settings: Settings,
    room_id: str,
    npc_id: str,
    *,
    limit: int = 40,
) -> list[dict[str, Any]]:
    """HTTP GET public timeline for one npc (T-27-16: active speak npc only)."""
    base = settings.game_server_url.rstrip("/")
    url = f"{base}/rooms/{room_id}/npcs/{npc_id}/personal-timeline"
    try:
        res = client.get(
            url,
            params={"limit": str(limit)},
            headers=_game_headers(settings),
            timeout=_TIMELINE_FETCH_TIMEOUT_S,
        )
        res.raise_for_status()
        payload = res.json()
        return list(payload.get("entries") or [])
    except Exception as exc:
        print(
            f"personal-timeline fetch failed room={room_id} npc={npc_id}: {exc}",
            file=sys.stderr,
        )
        return []


def fetch_personal_timeline_context(
    client: httpx.Client,
    settings: Settings,
    room_id: str,
    npc_id: str,
    query: str,
) -> list[str]:
    """Return 0–2 paraphrase bullets when topic overlaps (BIO-09 / D-RAG-01)."""
    entries = fetch_personal_timeline_entries(client, settings, room_id, npc_id)
    selected = select_personal_entries(query, entries)
    bullets: list[str] = []
    for entry in selected:
        bullet = format_personal_timeline_bullet(entry)
        if bullet:
            bullets.append(bullet)
    return bullets[:_MAX_PERSONAL_BULLETS]


def merge_personal_rag_into_canon(canon_context: str, personal_bullets: list[str]) -> str:
    """Append personal timeline section beside dual RAG block when bullets exist."""
    trimmed = [b for b in personal_bullets if b.strip()][:_MAX_PERSONAL_BULLETS]
    if not trimmed:
        return canon_context or ""
    section = "\n".join(
        ["个人人生时间线（自然引用，意译即可，勿复读原文）：", *trimmed]
    )
    base = (canon_context or "").strip()
    if not base:
        return section
    return f"{base}\n{section}"


def fetch_proposal_eligible_feed(
    client: httpx.Client,
    settings: Settings,
    room_id: str,
    npc_id: str,
    *,
    limit: int = 3,
) -> list[str]:
    """BIO-07: short paraphrase bullets from proposalEligible entries for vote context."""
    entries = fetch_personal_timeline_entries(client, settings, room_id, npc_id)
    eligible = filter_proposal_eligible_entries(entries)
    bullets: list[str] = []
    for entry in eligible[: max(1, limit * 2)]:
        bullet = format_personal_timeline_bullet(entry)
        if bullet:
            bullets.append(bullet)
        if len(bullets) >= limit:
            break
    return bullets
