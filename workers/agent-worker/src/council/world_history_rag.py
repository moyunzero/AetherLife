"""World history canon slice + dual RAG merge for speak (SOCIETY-01, D-VOTE-RAG-01…04)."""

from __future__ import annotations

import re
import sys
from typing import Any

import httpx

from src.config import Settings

_CANON_FETCH_TIMEOUT_S = 8.0
_MAX_CANON_BULLETS = 2
_MAX_COUNCIL_BULLETS = 2
_BULLET_MAX_LEN = 120

_TOPIC_KEYWORDS = frozenset(
    {
        "议会",
        "廷议",
        "投票",
        "表决",
        "法案",
        "提案",
        "编年史",
        "历史",
        "律法",
        "条例",
        "落槌",
        "通过",
        "否决",
        "创世",
        "奠基",
        "同僚",
        "议员",
    }
)


def _game_headers(settings: Settings) -> dict[str, str]:
    headers: dict[str, str] = {}
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


def topic_relevant(query: str, entries: list[dict[str, Any]]) -> bool:
    """Lightweight keyword overlap — skip RAG when query is off-topic (D-VOTE-RAG-01)."""
    q_tokens = _normalize_tokens(query)
    if not q_tokens:
        return False
    corpus_parts: list[str] = []
    for entry in entries:
        corpus_parts.append(str(entry.get("title") or ""))
        corpus_parts.append(str(entry.get("proposalExcerpt") or entry.get("proposal") or ""))
    corpus = " ".join(corpus_parts)
    c_tokens = _normalize_tokens(corpus)
    if q_tokens & c_tokens:
        return True
    if q_tokens & _TOPIC_KEYWORDS:
        return True
    return False


def select_canon_entries(entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Accepted votes + genesis rows + most recent rejected (D-VOTE-RAG-02)."""
    accepted_or_genesis: list[dict[str, Any]] = []
    rejected: list[dict[str, Any]] = []
    for entry in entries:
        status = entry.get("status")
        kind = entry.get("entryKind") or entry.get("entry_kind")
        if kind == "genesis" or status == "accepted":
            accepted_or_genesis.append(entry)
        elif status == "rejected":
            rejected.append(entry)
    selected = list(accepted_or_genesis)
    if rejected:
        latest = rejected[-1]
        if not any(e.get("id") == latest.get("id") for e in selected):
            selected.append(latest)
    return selected


def _truncate(text: str, max_len: int = _BULLET_MAX_LEN) -> str:
    stripped = (text or "").strip()
    if len(stripped) <= max_len:
        return stripped
    return f"{stripped[: max_len - 1]}…"


def format_canon_bullet(entry: dict[str, Any]) -> str:
    """Paraphrase bullet — cite tally/stance, not title verbatim (D-VOTE-RAG-03)."""
    title = str(entry.get("title") or "廷议")
    excerpt = str(entry.get("proposalExcerpt") or entry.get("proposal") or "")
    kind = entry.get("entryKind") or entry.get("entry_kind")
    status = entry.get("status")
    yes_count = entry.get("yesCount")
    no_count = entry.get("noCount")

    if kind == "genesis":
        gist = _truncate(excerpt or title, 60)
        return f"·创世文献（与表决 canon 同等权重）：{gist}（意译，勿念标题全文）"

    if status == "rejected":
        tally = ""
        if yes_count is not None and no_count is not None:
            tally = f"票型约{yes_count}赞成/{no_count}反对，"
        gist = _truncate(excerpt or title, 50)
        return f"·最近否决案：{tally}{gist}（可提同僚立场，勿复读标题）"

    tally = ""
    if yes_count is not None and no_count is not None:
        tally = f"以约{yes_count}赞成/{no_count}反对"
    gist = _truncate(excerpt or title, 50)
    return f"·已通过廷议{tally}：{gist}（意译，可引用同僚票型）"


def format_council_bullet(row: dict[str, Any]) -> str:
    text = _truncate(str(row.get("text") or row.get("summary") or ""), _BULLET_MAX_LEN - 2)
    if not text:
        return ""
    return f"·{text}"


def merge_dual_rag_block(
    query: str,
    *,
    canon_bullets: list[str],
    council_bullets: list[str],
    canon_entries: list[dict[str, Any]] | None = None,
) -> str:
    """Return prompt block with ≤2 canon + ≤2 council bullets when topic-relevant."""
    entries = canon_entries or []
    if not topic_relevant(query, entries) and not topic_relevant(query, [{"title": b} for b in canon_bullets]):
        return ""

    trimmed_canon = [b for b in canon_bullets if b.strip()][:_MAX_CANON_BULLETS]
    trimmed_council = [b for b in council_bullets if b.strip()][:_MAX_COUNCIL_BULLETS]
    if not trimmed_canon and not trimmed_council:
        return ""

    parts = ["【议会记忆｜自然引用】意译即可，可提同僚票型/立场，勿逐字念标题或条例。"]
    if trimmed_canon:
        parts.append("编年史 canon：")
        parts.extend(trimmed_canon)
    if trimmed_council:
        parts.append("议会辩论/表决记忆：")
        parts.extend(trimmed_council)
    return "\n".join(parts)


def fetch_world_history_canon_context(
    client: httpx.Client,
    settings: Settings,
    room_id: str,
    *,
    page_size: int = 20,
) -> list[dict[str, Any]]:
    """HTTP GET internal world-history list; return accepted + latest rejected + genesis."""
    base = settings.game_server_url.rstrip("/")
    url = f"{base}/internal/rooms/{room_id}/world-history"
    try:
        res = client.get(
            url,
            params={"status": "all", "page": "1", "pageSize": str(page_size)},
            headers=_game_headers(settings),
            timeout=_CANON_FETCH_TIMEOUT_S,
        )
        res.raise_for_status()
        payload = res.json()
        entries = list(payload.get("entries") or [])
        return select_canon_entries(entries)
    except Exception as exc:
        print(f"world-history canon fetch failed room={room_id}: {exc}", file=sys.stderr)
        return []
