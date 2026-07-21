"""Phase 28 relationship embedding RAG for speak (D-EMBED-01…04, D-VERIFY-01)."""

from __future__ import annotations

import pytest

from src.config import Settings
from src.council.relationship_rag import (
    fetch_relationship_rag_context,
    format_relationship_bullet,
    referenced_third_party_ids,
    select_relationship_edges,
    topic_relevant_relationship,
)


class FakeResponse:
    def __init__(self, status_code: int = 200, data: dict | None = None):
        self.status_code = status_code
        self._data = data or {"ok": True}

    def raise_for_status(self):
        if self.status_code >= 400:
            raise AssertionError(f"HTTP {self.status_code}")

    def json(self):
        return self._data


class FakeClient:
    def __init__(
        self,
        *,
        edges: list[dict] | None = None,
        vector_edges: list[dict] | None = None,
    ):
        self.edges = edges or []
        self.vector_edges = vector_edges or []
        self.gets: list[tuple[str, dict]] = []
        self.posts: list[tuple[str, dict]] = []

    def get(self, url, *args, **kwargs):
        self.gets.append((url, dict(kwargs.get("params") or {})))
        if "npc-relationships" in url and "search-similar" not in url:
            return FakeResponse(data={"ok": True, "edges": self.edges})
        return FakeResponse()

    def post(self, url, *args, **kwargs):
        body = dict(kwargs.get("json") or {})
        self.posts.append((url, body))
        if "search-similar" in url:
            return FakeResponse(data={"ok": True, "edges": self.vector_edges})
        if "ensure-embedding" in url:
            return FakeResponse(data={"ok": True, "embedded": True})
        return FakeResponse()


def _edge(
    *,
    npc_a: str,
    npc_b: str,
    history: str,
    status: list[str] | None = None,
):
    return {
        "npcAId": npc_a,
        "npcBId": npc_b,
        "historySummary": history,
        "currentStatus": status or [],
        "baseTag": "peer",
        "affection": 0,
        "trust": 50,
    }


@pytest.fixture
def settings():
    return Settings(game_server_url="http://game.test", internal_worker_token="tok")


def test_relationship_rag_prefers_active_npc_edges(settings):
    """D-EMBED-04: retrieve active NPC edges first for speak context."""
    edges = [
        _edge(npc_a="npc-1", npc_b="npc-2", history="旧日同盟，共议防务。"),
        _edge(npc_a="npc-3", npc_b="npc-4", history="npc-3 与 npc-4 私交甚笃。"),
        _edge(npc_a="npc-1", npc_b="npc-5", history="偶发口角，关系冷淡。"),
    ]
    selected = select_relationship_edges(
        "你和 npc-2 的关系如何？旧日同盟",
        edges,
        "npc-1",
    )
    assert selected
    assert all("npc-1" in (e["npcAId"], e["npcBId"]) for e in selected)
    assert selected[0]["npcBId"] == "npc-2" or selected[0]["npcAId"] == "npc-2"


def test_relationship_rag_third_party_analogy_paraphrase(settings):
    """D-EMBED-04 / D-VERIFY-01: cross-NPC analogy when topic references third party (≤2 bullets)."""
    long_history = (
        "他们曾在廷议中因边境防务激烈争执，彼此记恨多年，"
        "这段宿怨足以写满一整页编年史，不应被原样倾倒进 prompt。"
    )
    edges = [
        _edge(npc_a="npc-1", npc_b="npc-2", history="我与 npc-2 仅点头之交。"),
        _edge(npc_a="npc-3", npc_b="npc-4", history=long_history, status=["交恶"]),
    ]
    selected = select_relationship_edges(
        "npc-3 和 npc-4 是不是关系很差？",
        edges,
        "npc-1",
    )
    assert 1 <= len(selected) <= 2
    bullets = [format_relationship_bullet(e, "npc-1") for e in selected]
    joined = "\n".join(bullets)
    assert long_history not in joined
    assert "类比" in joined or "关系" in joined
    assert any("npc-3" in b or "npc-4" in b or "与" in b for b in bullets)


def test_relationship_rag_lazy_embed_when_missing(settings):
    """D-EMBED-03: lazy embed on speak if edge embedding is null."""
    client = FakeClient(
        edges=[
            _edge(npc_a="npc-1", npc_b="npc-2", history="封印裂隙旧盟。", status=["同盟"]),
        ]
    )
    bullets = fetch_relationship_rag_context(
        client,
        settings,
        "room-1",
        "npc-1",
        "你和 npc-2 的同盟关系？",
    )
    assert len(bullets) <= 2
    assert any("ensure-embedding" in url for url, _ in client.posts)
    assert bullets
    assert "封印" not in bullets[0] or "意译" in bullets[0]


def test_bullets_are_paraphrase_not_full_history_dump():
    raw = (
        "我们曾在议会边境防务案上激烈争执，彼此记恨多年，"
        "那些细节若被原样复读就会破坏 speak 的自然感。"
    )
    bullet = format_relationship_bullet(
        _edge(npc_a="npc-1", npc_b="npc-2", history=raw, status=["交恶"]),
        "npc-1",
    )
    assert bullet
    assert raw not in bullet
    assert "意译" in bullet or "勿" in bullet


def test_topic_relevant_and_third_party_detection():
    edges = [_edge(npc_a="npc-3", npc_b="npc-4", history="宿怨未消。", status=["敌对"])]
    assert topic_relevant_relationship("npc-3 关系如何", edges) is True
    assert "npc-3" in referenced_third_party_ids("提到 npc-3 的同僚", "npc-1")
