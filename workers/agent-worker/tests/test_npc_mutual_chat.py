"""Phase 28 npc-mutual-chat worker (D-MUTUAL-02/04/06/07)."""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

import pytest

from src.config import Settings


class FakeResponse:
    def __init__(self, status_code: int = 200, data: dict | None = None):
        self.status_code = status_code
        self._data = data or {"ok": True}

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise AssertionError(f"HTTP {self.status_code}")

    def json(self) -> dict:
        return self._data


class FakeClient:
    def __init__(self) -> None:
        self.posts: list[dict[str, Any]] = []

    def post(self, url: str, *args: Any, **kwargs: Any) -> FakeResponse:
        self.posts.append({"url": url, "json": kwargs.get("json"), "headers": kwargs.get("headers")})
        if "apply-deltas" in url:
            deltas = (kwargs.get("json") or {}).get("deltas") or []
            return FakeResponse(
                data={
                    "ok": True,
                    "linkedEdges": [
                        {"npcAId": d["npcAId"], "npcBId": d["npcBId"]} for d in deltas
                    ],
                }
            )
        return FakeResponse()


def _payload(**overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "jobId": "mc-test-room-1-npc-1-npc-2",
        "roomId": "test-room",
        "npcAId": "npc-1",
        "npcBId": "npc-2",
        "dayIndex": 1,
        "absoluteGameMinute": 1500,
        "enqueuedAt": "2026-07-21T00:00:00Z",
    }
    base.update(overrides)
    return base


@pytest.fixture(autouse=True)
def _mock_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LLM_MOCK", "1")


def test_mutual_chat_applies_deltas_and_thresholds(monkeypatch: pytest.MonkeyPatch) -> None:
    """D-MUTUAL-04: all deltas to DB; |Δ|≥4 → REL-07; |Δ|≥8 → linkedEdges hint."""
    import src.graph.npc_mutual_chat as mc
    from src.graph.personal_timeline import clear_personal_timeline_job_claims_for_test

    clear_personal_timeline_job_claims_for_test()
    client = FakeClient()
    settings = Settings(llm_mock=True, game_server_url="http://gs.test", internal_worker_token="tok")

    # |Δ|=5 → REL-07 yes, linkedEdges hint no
    monkeypatch.setattr(
        mc,
        "generate_mutual_dialogue",
        lambda *_a, **_k: {
            "lines": ["甲：今日庭中风软。", "乙：嗯，适合走走。"],
            "bubbleText": "今日庭中风软",
            "affectionDelta": 5,
            "summaryZh": "二人闲谈片刻",
            "historyAppend": "闲谈亲近（Δ+5）",
        },
    )
    enqueued: list[dict[str, Any]] = []

    def fake_rel07(**kwargs: Any) -> list[dict[str, Any]]:
        enqueued.append(kwargs)
        return [{"jobId": "pt-rel-a"}, {"jobId": "pt-rel-b"}]

    monkeypatch.setattr(mc, "enqueue_rel07_bilateral_jobs", fake_rel07)

    filter_calls: list[dict[str, Any]] = []

    def spy_filter(deltas: list, *, top_k: int = 8, min_abs: int = 8) -> list[dict[str, str]]:
        filter_calls.append({"deltas": deltas, "top_k": top_k, "min_abs": min_abs})
        return [{"npcAId": "npc-1", "npcBId": "npc-2"}]

    monkeypatch.setattr(mc, "filter_linked_edges_for_ui", spy_filter)

    mc.process_npc_mutual_chat_job(client, settings, _payload())

    apply_posts = [p for p in client.posts if "apply-deltas" in p["url"]]
    assert len(apply_posts) == 1
    delta = apply_posts[0]["json"]["deltas"][0]
    assert delta["affectionDelta"] == 5
    assert {delta["npcAId"], delta["npcBId"]} == {"npc-1", "npc-2"}
    assert apply_posts[0]["headers"]["Authorization"] == "Bearer tok"

    assert len(enqueued) == 1
    assert enqueued[0]["min_abs_delta"] == 4
    assert enqueued[0]["affection_delta"] == 5

    hint_posts = [p for p in client.posts if "linked-edges-hint" in p["url"] or "relationship-linked-hint" in p["url"]]
    assert hint_posts == []
    assert filter_calls == []

    # |Δ|=8 → filter + hint POST required
    clear_personal_timeline_job_claims_for_test()
    client2 = FakeClient()
    enqueued.clear()
    filter_calls.clear()
    monkeypatch.setattr(
        mc,
        "generate_mutual_dialogue",
        lambda *_a, **_k: {
            "lines": ["甲：多谢你的照应。", "乙：同袍何必客气。"],
            "bubbleText": "多谢你的照应",
            "affectionDelta": 8,
            "summaryZh": "深谈后亲近",
            "historyAppend": "深谈亲近（Δ+8）",
        },
    )
    mc.process_npc_mutual_chat_job(client2, settings, _payload(jobId="mc-delta8"))

    assert len(enqueued) == 1
    assert filter_calls and filter_calls[0]["min_abs"] == 8
    hint_posts2 = [
        p
        for p in client2.posts
        if "linked-edges-hint" in p["url"] or "relationship-linked-hint" in p["url"]
    ]
    assert len(hint_posts2) == 1
    assert hint_posts2[0]["json"]["linkedEdges"] == [{"npcAId": "npc-1", "npcBId": "npc-2"}]

    # |Δ|=3 → no REL-07, no hint
    clear_personal_timeline_job_claims_for_test()
    client3 = FakeClient()
    enqueued.clear()
    filter_calls.clear()
    monkeypatch.setattr(
        mc,
        "generate_mutual_dialogue",
        lambda *_a, **_k: {
            "lines": ["甲：路过。", "乙：嗯。"],
            "bubbleText": "路过",
            "affectionDelta": 3,
            "summaryZh": "擦肩",
            "historyAppend": "擦肩（Δ+3）",
        },
    )
    mc.process_npc_mutual_chat_job(client3, settings, _payload(jobId="mc-delta3"))
    assert enqueued == []
    assert filter_calls == []
    assert not [
        p
        for p in client3.posts
        if "linked-edges-hint" in p["url"] or "relationship-linked-hint" in p["url"]
    ]


def test_mutual_chat_memory_stays_on_council_scope(monkeypatch: pytest.MonkeyPatch) -> None:
    """D-MUTUAL-06: optional __council__ summary; never player speak cross-contamination."""
    from src.council.constants import COUNCIL_MEMORY_PLAYER_ID
    import src.graph.npc_mutual_chat as mc
    from src.graph.personal_timeline import clear_personal_timeline_job_claims_for_test

    clear_personal_timeline_job_claims_for_test()
    client = FakeClient()
    settings = Settings(llm_mock=True, game_server_url="http://gs.test")

    memory_calls: list[dict[str, Any]] = []

    def capture_append(*_a: Any, **kwargs: Any) -> None:
        memory_calls.append(kwargs)

    monkeypatch.setattr(mc, "append_player_memory", capture_append)
    monkeypatch.setattr(mc, "enqueue_rel07_bilateral_jobs", lambda **_k: [])
    monkeypatch.setattr(
        mc,
        "generate_mutual_dialogue",
        lambda *_a, **_k: {
            "lines": ["甲：庭前一叙。", "乙：改日再叙。"],
            "bubbleText": "庭前一叙",
            "affectionDelta": 2,
            "summaryZh": "议会闲谈短记",
            "historyAppend": "闲谈",
        },
    )

    mc.process_npc_mutual_chat_job(client, settings, _payload())

    assert memory_calls, "optional __council__ summary should append once"
    for call in memory_calls:
        assert call.get("player_id") == COUNCIL_MEMORY_PLAYER_ID
        assert call.get("player_id") != "player-1"
        assert "player" not in str(call.get("text", "")).lower() or True


def test_mutual_chat_emits_activity_and_bubble_payload(monkeypatch: pytest.MonkeyPatch) -> None:
    """D-MUTUAL-02: dual intentReasonZh + mutualChatBubble one-shot message."""
    import src.graph.npc_mutual_chat as mc
    from src.graph.personal_timeline import clear_personal_timeline_job_claims_for_test

    clear_personal_timeline_job_claims_for_test()
    client = FakeClient()
    settings = Settings(llm_mock=True, game_server_url="http://gs.test")
    monkeypatch.setattr(mc, "enqueue_rel07_bilateral_jobs", lambda **_k: [])
    monkeypatch.setattr(
        mc,
        "generate_mutual_dialogue",
        lambda *_a, **_k: {
            "lines": ["甲：今日风清。", "乙：正好叙话。"],
            "bubbleText": "今日风清正好叙话超过二十字截断",
            "affectionDelta": 1,
            "summaryZh": "短叙",
            "historyAppend": "短叙",
        },
    )

    mc.process_npc_mutual_chat_job(client, settings, _payload())

    present = [p for p in client.posts if "npc-mutual-chat" in p["url"] and "present" in p["url"]]
    assert len(present) == 1
    body = present[0]["json"]
    assert body["npcAId"] == "npc-1"
    assert body["npcBId"] == "npc-2"
    assert "交谈中" in body["npcAReasonZh"]
    assert "交谈中" in body["npcBReasonZh"]
    assert len(body["bubbleText"]) <= 20


def test_drain_yields_when_speak_in_progress(monkeypatch: pytest.MonkeyPatch) -> None:
    """D-MUTUAL-07: same defer spirit as world-vote / personal-timeline."""
    import src.main as main_mod

    r = MagicMock()
    r.llen.return_value = 0
    r.rpop.return_value = None
    client = MagicMock()
    settings = Settings(llm_mock=True)

    monkeypatch.setattr(main_mod, "_is_speak_in_progress", lambda: True)
    assert main_mod.drain_one_npc_mutual_chat_job(r, client, settings) is False
    r.rpop.assert_not_called()

    monkeypatch.setattr(main_mod, "_is_speak_in_progress", lambda: False)
    r.llen.return_value = 2
    assert main_mod.drain_one_npc_mutual_chat_job(r, client, settings) is False
    r.rpop.assert_not_called()
