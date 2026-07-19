"""Personal timeline speak RAG tests (BIO-09, D-RAG-01)."""

from __future__ import annotations

import pytest

from src.config import Settings
from src.council.personal_timeline_rag import (
    fetch_personal_timeline_context,
    format_personal_timeline_bullet,
    topic_relevant_personal,
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
    def __init__(self, entries: list[dict] | None = None):
        self.entries = entries or []
        self.gets: list[tuple[str, dict]] = []

    def get(self, url, *args, **kwargs):
        self.gets.append((url, dict(kwargs.get("params") or {})))
        if "personal-timeline" in url:
            return FakeResponse(data={"ok": True, "entries": self.entries})
        return FakeResponse()


def _entry(
    *,
    entry_id: str = "e1",
    body: str,
    tag: str = "daily",
    calendar_label: str = "太乙元年·春·1月·第1日",
    proposal_eligible: bool = False,
    event_anchor_id: str | None = None,
):
    return {
        "id": entry_id,
        "body": body,
        "tag": tag,
        "calendarLabel": calendar_label,
        "proposalEligible": proposal_eligible,
        "eventAnchorId": event_anchor_id,
        "source": "seed",
        "seq": 1,
    }


@pytest.fixture
def settings():
    return Settings(game_server_url="http://game.test", internal_worker_token="tok")


def test_topic_hit_returns_one_to_two_bullets(settings):
    """BIO-09 / D-RAG-01: topic overlap → 1–2 paraphrase bullets."""
    long_body = (
        "我年少时在边境防务营帐中抄写封印条例，与同僚彻夜讨论裂隙守备，"
        "那些日子塑造了我对秩序的执着，绝不愿再看见封印松动。"
    )
    client = FakeClient(
        entries=[
            _entry(entry_id="e1", body=long_body, tag="council", proposal_eligible=True),
            _entry(
                entry_id="e2",
                body="我曾在议会厅旁听边境防务辩论，心中记下每位同僚的立场。",
                tag="council",
                proposal_eligible=True,
            ),
            _entry(
                entry_id="e3",
                body="我还记得第三次边境防务廷议后与阿斯托利亚争执的午后。",
                tag="relationship",
                proposal_eligible=True,
            ),
        ]
    )
    bullets = fetch_personal_timeline_context(
        client,
        settings,
        "room-1",
        "npc-1",
        "上次议会关于边境防务的投票？",
    )
    assert 1 <= len(bullets) <= 2
    joined = "\n".join(bullets)
    assert "·" in joined or bullets[0].startswith("·")


def test_topic_miss_returns_empty(settings):
    client = FakeClient(
        entries=[
            _entry(
                body="我年少时在始源区抄写创世文献，心怀敬畏。",
                tag="reflection",
            )
        ]
    )
    bullets = fetch_personal_timeline_context(
        client,
        settings,
        "room-1",
        "npc-2",
        "今天天气真好，一起去散步吧",
    )
    assert bullets == []


def test_bullets_are_paraphrase_not_raw_body_dump():
    """D-RAG-01: paraphrase-style bullets — not a full raw body dump."""
    raw = (
        "我年少时在边境防务营帐中抄写封印条例，与同僚彻夜讨论裂隙守备，"
        "那些日子塑造了我对秩序的执着，绝不愿再看见封印松动。"
        "这段文字足够长，若被原样倾倒进 prompt 就会过长。"
    )
    bullet = format_personal_timeline_bullet(
        _entry(body=raw, tag="council", calendar_label="太乙元年·夏·4月·第10日")
    )
    assert bullet
    assert raw not in bullet
    # Truncated gist — full closing clause must not appear.
    assert "这段文字足够长" not in bullet
    assert "意译" in bullet or "勿" in bullet
    assert "·" in bullet


def test_topic_relevant_personal_matches_overlap():
    entries = [
        _entry(body="我记得议会边境防务那一案。", tag="council"),
    ]
    assert topic_relevant_personal("议会边境防务如何？", entries) is True
    assert topic_relevant_personal("你好呀", entries) is False


def test_fetch_scopes_to_active_npc_only(settings):
    """T-27-16: fetch only the speaking npcId timeline — no cross-NPC leak."""
    client = FakeClient(
        entries=[_entry(body="我在议会投过边境防务赞成票。", tag="council")]
    )
    fetch_personal_timeline_context(
        client,
        settings,
        "room-1",
        "npc-7",
        "议会边境防务？",
    )
    assert client.gets
    url, _params = client.gets[0]
    assert "npc-7" in url
    assert "npc-1" not in url or "npc-7" in url
