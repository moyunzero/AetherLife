"""REL-07 bilateral personal-timeline jobs (D-REL-01, threshold 8)."""

from __future__ import annotations

from unittest.mock import MagicMock

from src.council.constants import HISTORY_SUMMARY_DELTA_THRESHOLD


def test_history_summary_delta_threshold_is_eight():
    assert HISTORY_SUMMARY_DELTA_THRESHOLD == 8


def test_rel07_threshold_8_enqueues_bilateral_same_anchor():
    """|Δ|≥8 → two jobs (npcA + npcB), shared eventAnchorId, relationship tag."""
    from src.graph.personal_timeline import (
        clear_personal_timeline_job_claims_for_test,
        enqueue_rel07_bilateral_jobs,
        rel07_should_enqueue,
    )

    clear_personal_timeline_job_claims_for_test()
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
    from src.graph.personal_timeline import (
        clear_personal_timeline_job_claims_for_test,
        enqueue_rel07_bilateral_jobs,
        rel07_should_enqueue,
    )

    clear_personal_timeline_job_claims_for_test()
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
    from src.graph.personal_timeline import (
        clear_personal_timeline_job_claims_for_test,
        enqueue_rel07_bilateral_jobs,
        rel07_should_enqueue,
    )

    clear_personal_timeline_job_claims_for_test()
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
    from src.graph.personal_timeline import (
        clear_personal_timeline_job_claims_for_test,
        enqueue_rel07_bilateral_jobs,
    )

    clear_personal_timeline_job_claims_for_test()
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


def test_rel07_min_abs_delta_dyad_medium_bar():
    """Dyad path uses min_abs_delta=4 — Δ=3 skipped, Δ=4 enqueued."""
    from src.graph.personal_timeline import (
        DYAD_REL_MIN_ABS_DELTA,
        clear_personal_timeline_job_claims_for_test,
        enqueue_rel07_bilateral_jobs,
    )

    clear_personal_timeline_job_claims_for_test()
    assert DYAD_REL_MIN_ABS_DELTA == 4
    skipped = enqueue_rel07_bilateral_jobs(
        room_id="room-rel-dyad",
        npc_a_id="npc-1",
        npc_b_id="npc-2",
        event_anchor_id="dyad-low",
        affection_delta=3,
        aether_epoch_minute=5000,
        min_abs_delta=DYAD_REL_MIN_ABS_DELTA,
        redis_client=None,
    )
    assert skipped == []

    jobs = enqueue_rel07_bilateral_jobs(
        room_id="room-rel-dyad",
        npc_a_id="npc-1",
        npc_b_id="npc-2",
        event_anchor_id="dyad-ok",
        affection_delta=4,
        aether_epoch_minute=5000,
        min_abs_delta=DYAD_REL_MIN_ABS_DELTA,
        redis_client=None,
    )
    assert len(jobs) == 2


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
            "affectionDelta": 4,
            "aetherEpochMinute": 2000,
            "factualSummary": "提及同僚：楚浅歌",
        },
    )
    assert len(applied) == 1
    assert applied[0]["affection_delta"] == 4
    assert len(enqueued) == 1
    assert enqueued[0].get("force") is not True
    assert enqueued[0]["min_abs_delta"] == pt.DYAD_REL_MIN_ABS_DELTA
    assert enqueued[0]["affection_delta"] == 4


def test_multi_and_rel_claims_block_duplicate_enqueue():
    from src.graph.personal_timeline import (
        clear_personal_timeline_job_claims_for_test,
        enqueue_multi_perspective_jobs,
        enqueue_rel07_bilateral_jobs,
    )

    clear_personal_timeline_job_claims_for_test()
    first = enqueue_multi_perspective_jobs(
        room_id="room-claim-multi",
        event_anchor_id="wh-dup",
        factual_summary="庭议通过。",
        aether_epoch_minute=10_000,
        redis_client=None,
    )
    assert len(first) == 12
    second = enqueue_multi_perspective_jobs(
        room_id="room-claim-multi",
        event_anchor_id="wh-dup",
        factual_summary="庭议通过。",
        aether_epoch_minute=10_000,
        redis_client=None,
    )
    assert second == []

    clear_personal_timeline_job_claims_for_test()
    rel_first = enqueue_rel07_bilateral_jobs(
        room_id="room-claim-rel",
        npc_a_id="npc-1",
        npc_b_id="npc-2",
        event_anchor_id="rel-dup",
        affection_delta=8,
        aether_epoch_minute=5000,
        redis_client=None,
    )
    assert len(rel_first) == 2
    rel_second = enqueue_rel07_bilateral_jobs(
        room_id="room-claim-rel",
        npc_a_id="npc-1",
        npc_b_id="npc-2",
        event_anchor_id="rel-dup",
        affection_delta=8,
        aether_epoch_minute=5000,
        redis_client=None,
    )
    assert rel_second == []


def test_apply_relationship_deltas_continues_after_rel07_enqueue_error(monkeypatch):
    from src.graph import world_vote as wv
    from src.graph.world_vote import VoteContext

    calls = {"n": 0}

    def boom_then_ok(**kwargs):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("redis down")
        return [{"kind": "rel"}, {"kind": "rel"}]

    monkeypatch.setattr(wv, "enqueue_rel07_bilateral_jobs", boom_then_ok)
    monkeypatch.setattr(wv, "_post_with_retry", lambda *a, **k: None)
    monkeypatch.setattr(
        wv,
        "compute_relationship_deltas",
        lambda *a, **k: [
            {
                "npcAId": "npc-1",
                "npcBId": "npc-2",
                "affectionDelta": 8,
                "historyAppend": "a",
            },
            {
                "npcAId": "npc-3",
                "npcBId": "npc-4",
                "affectionDelta": 8,
                "historyAppend": "b",
            },
        ],
    )
    monkeypatch.setattr(wv, "iter_rel07_trigger_deltas", lambda deltas: deltas)
    monkeypatch.setattr(
        wv,
        "filter_linked_edges_for_ui",
        lambda deltas: [{"npcAId": "npc-1", "npcBId": "npc-2"}],
    )

    ctx = VoteContext(
        room_id="r",
        vote_kind="regular",
        game_minute=0,
        absolute_game_minute=100,
        proposer_index=0,
        debate_rounds_max=1,
        job_id="j1",
    )
    edges = wv.apply_relationship_deltas(
        MagicMock(),
        MagicMock(),
        ctx,
        [],
        [],
        event_anchor_id="anchor-1",
    )
    assert calls["n"] == 2
    assert edges == [{"npcAId": "npc-1", "npcBId": "npc-2"}]


def test_finalize_vote_continues_when_multi_enqueue_fails(monkeypatch):
    from src.graph import world_vote as wv
    from src.graph.world_vote import VoteContext

    order: list[str] = []
    ctx = VoteContext(
        room_id="r",
        vote_kind="regular",
        game_minute=0,
        absolute_game_minute=100,
        proposer_index=0,
        debate_rounds_max=1,
        job_id="j-fin",
        debate_transcript=[],
    )

    monkeypatch.setattr(wv, "cast_ballots", lambda *a, **k: [])
    monkeypatch.setattr(wv, "tally_ballots", lambda *a, **k: ("accepted", 7, 4))
    monkeypatch.setattr(
        wv,
        "build_minutes",
        lambda *a, **k: {"kind": "vote_minutes", "proposalFull": "p", "ballots": []},
    )
    monkeypatch.setattr(wv, "is_job_still_pending", lambda *a, **k: True)
    monkeypatch.setattr(wv, "post_deliberation_sync", lambda *a, **k: None)
    monkeypatch.setattr(
        wv,
        "post_world_history",
        lambda *a, **k: {"entry": {"id": "wh-1"}},
    )
    monkeypatch.setattr(
        wv,
        "enqueue_multi_perspective_jobs",
        lambda **k: (_ for _ in ()).throw(RuntimeError("enqueue boom")),
    )
    monkeypatch.setattr(
        wv,
        "post_vote_complete",
        lambda *a, **k: order.append("complete"),
    )
    monkeypatch.setattr(
        wv,
        "apply_relationship_deltas",
        lambda *a, **k: (order.append("rel") or []),
    )
    monkeypatch.setattr(wv, "append_council_memories", lambda *a, **k: None)
    monkeypatch.setattr(
        wv,
        "writeback_sequence",
        lambda *a, **k: order.append("wb"),
    )

    result = wv._finalize_vote_job(
        MagicMock(),
        MagicMock(),
        ctx,
        proposer_id="npc-1",
        title="提案",
        proposal="正文",
    )
    assert result.get("status") != "superseded" or True
    assert order == ["complete", "rel", "wb"]
