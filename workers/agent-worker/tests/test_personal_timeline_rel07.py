"""REL-07 bilateral personal-timeline jobs (D-REL-01, threshold 8)."""

from __future__ import annotations

from unittest.mock import MagicMock

from src.council.constants import HISTORY_SUMMARY_DELTA_THRESHOLD


def test_history_summary_delta_threshold_is_eight():
    assert HISTORY_SUMMARY_DELTA_THRESHOLD == 8


def test_rel07_threshold_8_enqueues_bilateral_same_anchor():
    """|Δ|≥8 → two jobs (npcA + npcB), shared eventAnchorId, relationship tag."""
    from src.graph.personal_timeline import enqueue_rel07_bilateral_jobs, rel07_should_enqueue

    assert rel07_should_enqueue(affection_delta=8, status_tags_changed=False) is True
    assert rel07_should_enqueue(affection_delta=-8, status_tags_changed=False) is True

    jobs = enqueue_rel07_bilateral_jobs(
        room_id="room-rel",
        npc_a_id="npc-1",
        npc_b_id="npc-2",
        event_anchor_id="wh-entry-99",
        affection_delta=8,
        aether_epoch_minute=5000,
        history_append="廷议后亲近（Δ+8）",
        redis_client=None,
    )
    assert len(jobs) == 2
    npc_ids = {j["npcId"] for j in jobs}
    assert npc_ids == {"npc-1", "npc-2"}
    assert all(j["eventAnchorId"] == "wh-entry-99" for j in jobs)
    assert all(j["kind"] == "rel" for j in jobs)
    assert all(j["tag"] == "relationship" for j in jobs)
    assert all(j["counterpartNpcId"] in {"npc-1", "npc-2"} for j in jobs)
    assert all(j["counterpartNpcId"] != j["npcId"] for j in jobs)


def test_rel07_delta_7_does_not_enqueue():
    from src.graph.personal_timeline import enqueue_rel07_bilateral_jobs, rel07_should_enqueue

    assert rel07_should_enqueue(affection_delta=7, status_tags_changed=False) is False
    assert rel07_should_enqueue(affection_delta=-7, status_tags_changed=False) is False
    jobs = enqueue_rel07_bilateral_jobs(
        room_id="room-rel",
        npc_a_id="npc-1",
        npc_b_id="npc-2",
        event_anchor_id="wh-entry-7",
        affection_delta=7,
        aether_epoch_minute=5000,
        redis_client=None,
    )
    assert jobs == []


def test_rel07_status_tags_change_enqueues_even_below_threshold():
    from src.graph.personal_timeline import enqueue_rel07_bilateral_jobs, rel07_should_enqueue

    assert rel07_should_enqueue(affection_delta=2, status_tags_changed=True) is True
    jobs = enqueue_rel07_bilateral_jobs(
        room_id="room-rel",
        npc_a_id="npc-3",
        npc_b_id="npc-4",
        event_anchor_id="vote-epoch-1",
        affection_delta=2,
        aether_epoch_minute=6000,
        status_tags_changed=True,
        redis_client=None,
    )
    assert len(jobs) == 2
    assert {j["npcId"] for j in jobs} == {"npc-3", "npc-4"}


def test_rel07_prompt_relationship_budget_100_200():
    """D-GEN-05: REL bodies 100–200 字."""
    from src.graph.personal_timeline import build_rel07_prompt

    prompt = build_rel07_prompt(
        npc_id="npc-1",
        display_name="莫玄虚",
        counterpart_id="npc-2",
        counterpart_name="沈清晏",
        affection_delta=10,
        history_append="廷议后亲近（Δ+10）",
    )
    assert "第一人称" in prompt
    assert "100" in prompt and "200" in prompt
    assert "关系" in prompt or "relationship" in prompt.lower()
    assert "口吻" in prompt or "人设" in prompt


def test_rel07_force_enqueues_below_threshold():
    from src.graph.personal_timeline import enqueue_rel07_bilateral_jobs

    jobs = enqueue_rel07_bilateral_jobs(
        room_id="room-rel-force",
        npc_a_id="npc-1",
        npc_b_id="npc-2",
        event_anchor_id="dyad-speak-1",
        affection_delta=3,
        aether_epoch_minute=5000,
        force=True,
        redis_client=None,
    )
    assert len(jobs) == 2
    assert all(j["eventAnchorId"] == "dyad-speak-1" for j in jobs)


def test_run_event_applies_delta_and_force_enqueues(monkeypatch):
    from src.graph import personal_timeline as pt

    applied: list[dict] = []
    enqueued: list[dict] = []

    def fake_apply(client, settings, **kwargs):
        applied.append(kwargs)

    def fake_enqueue(**kwargs):
        enqueued.append(kwargs)
        return [{"kind": "rel"}, {"kind": "rel"}]

    monkeypatch.setattr(pt, "apply_single_relationship_delta", fake_apply)
    monkeypatch.setattr(pt, "enqueue_rel07_bilateral_jobs", fake_enqueue)

    pt._run_event(
        MagicMock(),
        MagicMock(),
        {
            "jobId": "pt-event-1",
            "roomId": "room-e",
            "npcId": "npc-2",
            "counterpartNpcId": "npc-9",
            "eventAnchorId": "dyad-speak-room-e-1-npc-2-npc-9",
            "affectionDelta": 3,
            "aetherEpochMinute": 2000,
            "factualSummary": "提及同僚：楚浅歌",
        },
    )
    assert len(applied) == 1
    assert applied[0]["affection_delta"] == 3
    assert len(enqueued) == 1
    assert enqueued[0]["force"] is True
    assert enqueued[0]["affection_delta"] == 3
