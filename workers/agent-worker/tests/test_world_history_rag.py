"""Dual-source world_history + __council__ RAG tests (SOCIETY-01, D-VOTE-RAG-01…06)."""

from __future__ import annotations

import pytest

from src.config import Settings
from src.council.memory_context import fetch_dual_rag_context
from src.council.world_history_rag import (
    fetch_world_history_canon_context,
    merge_dual_rag_block,
    select_canon_entries,
    topic_relevant,
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
    def __init__(self, entries: list[dict] | None = None, council_retrieved: list[dict] | None = None):
        self.entries = entries or []
        self.council_retrieved = council_retrieved or []
        self.gets: list[str] = []

    def get(self, url, *args, **kwargs):
        self.gets.append(url)
        if "world-history" in url:
            return FakeResponse(data={"ok": True, "entries": self.entries})
        if "memory-context" in url:
            return FakeResponse(
                data={
                    "retrieved": self.council_retrieved,
                    "memoryCount": len(self.council_retrieved),
                }
            )
        return FakeResponse()


def _entry(
    *,
    entry_id: str,
    title: str,
    status: str = "accepted",
    entry_kind: str = "vote",
    proposal_excerpt: str = "",
    yes_count: int | None = 6,
    no_count: int | None = 5,
):
    return {
        "id": entry_id,
        "entryKind": entry_kind,
        "status": status,
        "title": title,
        "proposalExcerpt": proposal_excerpt or title,
        "yesCount": yes_count,
        "noCount": no_count,
        "tallyLabel": f"{yes_count}赞成/{no_count}反对" if yes_count is not None else None,
    }


@pytest.fixture
def settings():
    return Settings(game_server_url="http://game.test", internal_worker_token="tok")


def test_select_canon_includes_accepted_genesis_and_latest_rejected():
    # Newest-first (matches GET /world-history ORDER BY sequence DESC).
    entries = [
        _entry(entry_id="v4", title="最新通过", status="accepted"),
        _entry(entry_id="v3", title="最新否决", status="rejected"),
        _entry(entry_id="v2", title="旧案否决", status="rejected"),
        _entry(entry_id="v1", title="旧案通过", status="accepted"),
        _entry(entry_id="g1", title="创世·秩序之锚", entry_kind="genesis", status="accepted"),
    ]
    selected = select_canon_entries(entries)
    ids = {e["id"] for e in selected}
    assert "g1" in ids
    assert "v4" in ids
    assert "v3" in ids
    assert "v2" not in ids


def test_topic_gate_skips_unrelated_query():
    entries = [_entry(entry_id="v1", title="边境防务条例", proposal_excerpt="加强封印")]
    assert topic_relevant("今天天气真好", entries) is False


def test_topic_gate_matches_council_keywords():
    entries = [_entry(entry_id="v1", title="边境防务条例", proposal_excerpt="加强封印")]
    assert topic_relevant("上次议会边境防务怎么说？", entries) is True


def test_merge_dual_rag_bounded_bullets():
    canon = [
        "·上次廷议以6赞成通过边境防务调整（意译，勿念标题）",
        "·最近否决案：多数议员反对开放裂隙（可提同僚立场）",
    ]
    council = [
        "·辩论记忆：莫玄虚强调秩序先例",
        "·表决记忆：阿斯托利亚推动扩张条款",
        "·第三条应被截断",
    ]
    block = merge_dual_rag_block(
        "议会上次投票结果如何？",
        canon_bullets=canon,
        council_bullets=council,
    )
    assert block
    assert block.count("·") <= 4
    assert "意译" in block or "同僚" in block


def test_merge_dual_rag_empty_when_not_relevant():
    block = merge_dual_rag_block(
        "你好呀",
        canon_bullets=["·不应出现"],
        council_bullets=["·也不应出现"],
    )
    assert block == ""


@pytest.mark.parametrize("npc_id", ["npc-1", "npc-7", "npc-11"])
def test_fetch_dual_rag_passes_npc_id_to_council_memory(npc_id, settings, monkeypatch):
    client = FakeClient(
        entries=[_entry(entry_id="v1", title="议会防务条例", proposal_excerpt="封印议题")],
        council_retrieved=[{"text": f"{npc_id} 在辩论中反对开放裂隙", "importance": 4}],
    )
    captured: dict[str, str] = {}

    def _spy_fetch_council_memory_context(client, settings, room_id, query, *, npc_id="npc-1", skip_embed=False):
        captured["npc_id"] = npc_id
        return {"retrieved": client.council_retrieved}

    monkeypatch.setattr(
        "src.council.memory_context.fetch_council_memory_context",
        _spy_fetch_council_memory_context,
    )

    result = fetch_dual_rag_context(
        client,
        settings,
        "room-1",
        "上次议会关于防务的投票？",
        npc_id=npc_id,
    )
    assert captured["npc_id"] == npc_id
    assert "canon_context" in result
    if result["canon_context"]:
        assert result["canon_context"].count("·") <= 4


def test_fetch_world_history_canon_context_uses_internal_route(settings):
    client = FakeClient(entries=[_entry(entry_id="v1", title="测试案", status="accepted")])
    rows = fetch_world_history_canon_context(client, settings, "room-1")
    assert rows
    assert any("world-history" in url for url in client.gets)
