"""Relationship edge Speak RAG (D-EMBED-01…04) — paraphrase discipline like personal_timeline_rag."""

from __future__ import annotations

import re
import sys
from typing import Any

import httpx

from src.config import Settings
from src.council.constants import COUNCIL_NPC_IDS
from src.council.registry import display_name

_REL_FETCH_TIMEOUT_S = 8.0
_MAX_REL_BULLETS = 2
_PARAPHRASE_BODY_LEN = 48

_TOPIC_KEYWORDS = frozenset(
    {
        "关系",
        "同僚",
        "议员",
        "亲密",
        "冷淡",
        "敌对",
        "同盟",
        "旧怨",
        "信任",
        "交恶",
        "疏远",
        "议会",
        "廷议",
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
    for npc_id in COUNCIL_NPC_IDS:
        name = display_name(npc_id)
        if name and name in (text or ""):
            tokens.add(name)
    return tokens


def referenced_third_party_ids(query: str, active_npc_id: str) -> list[str]:
    """NPC ids mentioned in query besides the speaking NPC (D-EMBED-04)."""
    found: list[str] = []
    for npc_id in COUNCIL_NPC_IDS:
        if npc_id == active_npc_id:
            continue
        name = display_name(npc_id)
        if npc_id in query or (name and name in query):
            found.append(npc_id)
    return found


def topic_relevant_relationship(query: str, edges: list[dict[str, Any]]) -> bool:
    q_tokens = _normalize_tokens(query)
    if not q_tokens:
        return False
    corpus_parts: list[str] = []
    for edge in edges:
        corpus_parts.append(str(edge.get("historySummary") or ""))
        for tag in edge.get("currentStatus") or []:
            corpus_parts.append(str(tag))
    corpus = " ".join(corpus_parts)
    c_tokens = _normalize_tokens(corpus)
    if q_tokens & c_tokens:
        return True
    if q_tokens & _TOPIC_KEYWORDS and c_tokens & _TOPIC_KEYWORDS:
        return True
    return False


def _truncate(text: str, max_len: int) -> str:
    stripped = (text or "").strip()
    if len(stripped) <= max_len:
        return stripped
    return f"{stripped[: max_len - 1]}…"


def peer_npc_id(edge: dict[str, Any], active_npc_id: str) -> str:
    if edge.get("npcAId") == active_npc_id:
        return str(edge.get("npcBId") or "")
    if edge.get("npcBId") == active_npc_id:
        return str(edge.get("npcAId") or "")
    return str(edge.get("npcBId") or edge.get("npcAId") or "")


def format_relationship_bullet(edge: dict[str, Any], active_npc_id: str) -> str:
    """Paraphrase bullet — never dump full history_summary (D-RAG-01 style)."""
    history = str(edge.get("historySummary") or "").strip()
    status = [str(t) for t in (edge.get("currentStatus") or []) if str(t).strip()]
    peer = peer_npc_id(edge, active_npc_id)
    peer_name = display_name(peer) if peer in COUNCIL_NPC_IDS else peer
    status_gist = "、".join(status[:2]) if status else ""
    raw_gist = history or status_gist
    gist = _truncate(raw_gist, _PARAPHRASE_BODY_LEN)
    if history and history in gist and len(history) > _PARAPHRASE_BODY_LEN:
        gist = _truncate(history, _PARAPHRASE_BODY_LEN)
    if active_npc_id in (edge.get("npcAId"), edge.get("npcBId")):
        return f"·与{peer_name}的关系：{gist}（意译，勿复读原文）"
    # Cross-NPC analogy when edge does not include active NPC
    a_name = display_name(str(edge.get("npcAId") or "")) or edge.get("npcAId")
    b_name = display_name(str(edge.get("npcBId") or "")) or edge.get("npcBId")
    return f"·{a_name}与{b_name}之间：{gist}（类比参考，勿复读原文）"


def score_edge_for_query(query: str, edge: dict[str, Any], active_npc_id: str) -> int:
    q_tokens = _normalize_tokens(query)
    if not q_tokens:
        return 0
    blob = " ".join(
        [
            str(edge.get("historySummary") or ""),
            " ".join(str(t) for t in (edge.get("currentStatus") or [])),
            peer_npc_id(edge, active_npc_id),
            display_name(peer_npc_id(edge, active_npc_id)) or "",
        ]
    )
    e_tokens = _normalize_tokens(blob)
    score = len(q_tokens & e_tokens)
    if active_npc_id in (edge.get("npcAId"), edge.get("npcBId")):
        score += 3
    return score


def select_relationship_edges(
    query: str,
    edges: list[dict[str, Any]],
    active_npc_id: str,
    *,
    limit: int = _MAX_REL_BULLETS,
) -> list[dict[str, Any]]:
    if not topic_relevant_relationship(query, edges):
        return []

    active_edges = [
        e for e in edges if active_npc_id in (e.get("npcAId"), e.get("npcBId"))
    ]
    cross_edges = [
        e for e in edges if active_npc_id not in (e.get("npcAId"), e.get("npcBId"))
    ]
    third_parties = referenced_third_party_ids(query, active_npc_id)

    ranked_active = sorted(
        active_edges,
        key=lambda e: score_edge_for_query(query, e, active_npc_id),
        reverse=True,
    )
    selected: list[dict[str, Any]] = []
    for edge in ranked_active:
        if score_edge_for_query(query, edge, active_npc_id) <= 0 and not (
            _normalize_tokens(str(edge.get("historySummary") or "")) & _TOPIC_KEYWORDS
        ):
            continue
        selected.append(edge)
        if len(selected) >= limit:
            break

    if len(selected) < limit and third_parties:
        analogy_pool = [
            e
            for e in cross_edges
            if any(tp in (e.get("npcAId"), e.get("npcBId")) for tp in third_parties)
        ]
        ranked_analogy = sorted(
            analogy_pool,
            key=lambda e: score_edge_for_query(query, e, active_npc_id),
            reverse=True,
        )
        for edge in ranked_analogy:
            if len(selected) >= limit:
                break
            selected.append(edge)

    return selected[:limit]


def fetch_relationship_edges(
    client: httpx.Client,
    settings: Settings,
    room_id: str,
    npc_id: str,
    *,
    limit: int = 12,
) -> list[dict[str, Any]]:
    base = settings.game_server_url.rstrip("/")
    url = f"{base}/internal/rooms/{room_id}/npc-relationships"
    try:
        res = client.get(
            url,
            params={"npcId": npc_id, "limit": str(limit)},
            headers=_game_headers(settings),
            timeout=_REL_FETCH_TIMEOUT_S,
        )
        res.raise_for_status()
        payload = res.json()
        return list(payload.get("edges") or [])
    except Exception as exc:
        print(
            f"relationship edges fetch failed room={room_id} npc={npc_id}: {exc}",
            file=sys.stderr,
        )
        return []


def request_lazy_edge_embed(
    client: httpx.Client,
    settings: Settings,
    room_id: str,
    npc_a_id: str,
    npc_b_id: str,
) -> bool:
    """D-EMBED-03: lazy embed when speak selects edge without vector."""
    base = settings.game_server_url.rstrip("/")
    url = f"{base}/internal/rooms/{room_id}/npc-relationships/ensure-embedding"
    try:
        res = client.post(
            url,
            json={"npcAId": npc_a_id, "npcBId": npc_b_id},
            headers=_game_headers(settings),
            timeout=_REL_FETCH_TIMEOUT_S,
        )
        res.raise_for_status()
        payload = res.json()
        return bool(payload.get("embedded"))
    except Exception as exc:
        print(
            f"relationship lazy embed failed room={room_id} {npc_a_id}/{npc_b_id}: {exc}",
            file=sys.stderr,
        )
        return False


def fetch_vector_ranked_edges(
    client: httpx.Client,
    settings: Settings,
    room_id: str,
    active_npc_id: str,
    query: str,
    *,
    k: int = 5,
) -> list[dict[str, Any]]:
    base = settings.game_server_url.rstrip("/")
    url = f"{base}/internal/rooms/{room_id}/npc-relationships/search-similar"
    try:
        res = client.post(
            url,
            json={"query": query, "activeNpcId": active_npc_id, "k": k},
            headers=_game_headers(settings),
            timeout=_REL_FETCH_TIMEOUT_S,
        )
        res.raise_for_status()
        payload = res.json()
        return list(payload.get("edges") or [])
    except Exception as exc:
        print(
            f"relationship search-similar failed room={room_id} npc={active_npc_id}: {exc}",
            file=sys.stderr,
        )
        return []


def fetch_relationship_rag_context(
    client: httpx.Client,
    settings: Settings,
    room_id: str,
    active_npc_id: str,
    query: str,
) -> list[str]:
    """Return 0–2 paraphrase bullets for speak (D-EMBED-01/04)."""
    if not active_npc_id.startswith("npc-"):
        return []

    vector_hits = fetch_vector_ranked_edges(
        client, settings, room_id, active_npc_id, query, k=_MAX_REL_BULLETS + 2
    )
    edges = fetch_relationship_edges(client, settings, room_id, active_npc_id)
    if not edges and vector_hits:
        edges = vector_hits

    selected = select_relationship_edges(query, edges, active_npc_id)
    if vector_hits and not selected:
        selected = vector_hits[:_MAX_REL_BULLETS]
    elif vector_hits:
        # Prefer vector ordering for active-npc hits when topic matches
        merged: list[dict[str, Any]] = []
        seen: set[tuple[str, str]] = set()
        for edge in vector_hits + selected:
            key = (str(edge.get("npcAId")), str(edge.get("npcBId")))
            if key in seen:
                continue
            seen.add(key)
            merged.append(edge)
        selected = merged[:_MAX_REL_BULLETS]

    for edge in selected:
        request_lazy_edge_embed(
            client,
            settings,
            room_id,
            str(edge.get("npcAId") or ""),
            str(edge.get("npcBId") or ""),
        )

    bullets: list[str] = []
    for edge in selected:
        bullet = format_relationship_bullet(edge, active_npc_id)
        if bullet:
            bullets.append(bullet)
    return bullets[:_MAX_REL_BULLETS]


def merge_relationship_rag_into_canon(canon_context: str, relationship_bullets: list[str]) -> str:
    trimmed = [b for b in relationship_bullets if b.strip()][:_MAX_REL_BULLETS]
    if not trimmed:
        return canon_context or ""
    section = "\n".join(["议会关系网（自然引用，意译即可，勿复读原文）：", *trimmed])
    base = (canon_context or "").strip()
    if not base:
        return section
    return f"{base}\n{section}"
