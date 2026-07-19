"""Personal timeline worker contracts (BIO-03/05, D-GEN-04/05, yield-to-speak)."""

from __future__ import annotations

import json
from unittest.mock import MagicMock

from src.config import Settings
from src.main import BRIDGE_LIST_KEY, drain_one_personal_timeline_job


PERSONAL_TIMELINE_JOBS_KEY = "aetherlife:personal-timeline:jobs"


def test_personal_timeline_llm_never_zhipu_or_npc_provider():
    """BIO-05 / D-GEN-04: reflect/lore only — ban Zhipu speak slot."""
    from src.graph.personal_timeline import personal_timeline_llm_attempts

    settings = Settings(
        llm_mock=False,
        llm_provider="zhipu",
        llm_provider_reflect="agnes",
        llm_provider_lore="agnes",
    )
    attempts = personal_timeline_llm_attempts(settings)
    providers = [p for p, _ in attempts]
    assert "zhipu" not in providers
    assert any(p in {"agnes", "nvidia"} for p in providers)


def test_drain_one_personal_timeline_job_defers_when_speak_in_progress(monkeypatch):
    r = MagicMock()
    r.llen.return_value = 0
    monkeypatch.setattr("src.main._is_speak_in_progress", lambda: True)

    settings = Settings(llm_mock=True, game_server_url="http://127.0.0.1:2567")
    handled = drain_one_personal_timeline_job(r, MagicMock(), settings)

    assert handled is False
    r.rpop.assert_not_called()


def test_drain_one_personal_timeline_job_defers_when_npc_turn_backlog(monkeypatch):
    r = MagicMock()
    r.llen.return_value = 2
    monkeypatch.setattr("src.main._is_speak_in_progress", lambda: False)

    settings = Settings(llm_mock=True, game_server_url="http://127.0.0.1:2567")
    handled = drain_one_personal_timeline_job(r, MagicMock(), settings)

    assert handled is False
    r.llen.assert_called_with(BRIDGE_LIST_KEY)
    r.rpop.assert_not_called()


def test_drain_one_personal_timeline_job_processes_rpop_payload(monkeypatch):
    payload = {
        "kind": "weekly",
        "jobId": "pt-weekly-room-npc-1-0",
        "roomId": "room-pt",
        "npcId": "npc-1",
        "aetherEpochMinute": 10080,
    }
    r = MagicMock()
    r.llen.return_value = 0
    r.rpop.return_value = json.dumps(payload).encode()

    calls: list[dict] = []

    def fake_process(client, settings, body):
        calls.append(body)

    monkeypatch.setattr("src.main._is_speak_in_progress", lambda: False)
    monkeypatch.setattr("src.main.process_personal_timeline_job", fake_process)

    settings = Settings(llm_mock=True, game_server_url="http://127.0.0.1:2567")
    handled = drain_one_personal_timeline_job(r, MagicMock(), settings)

    assert handled is True
    r.rpop.assert_called_once_with(PERSONAL_TIMELINE_JOBS_KEY)
    assert calls == [payload]


def test_weekly_prompt_first_person_and_budget():
    """BIO-03 / D-GEN-05: weekly body 200–400 字, first-person."""
    from src.graph.personal_timeline import build_weekly_digest_prompt

    prompt = build_weekly_digest_prompt(
        npc_id="npc-1",
        display_name="莫玄虚",
        calendar_label="太乙1年·春·1月·第1日",
        recent_bullets=["近日庭议未歇。"],
    )
    assert "第一人称" in prompt
    assert "200" in prompt and "400" in prompt


def test_multi_prompt_locks_factual_summary_and_budget():
    """BIO-06 / D-MULTI-03 / D-GEN-05: ≤80 字; forbid fact rewrite."""
    from src.graph.personal_timeline import build_multi_perspective_prompt

    factual = "议会以七票通过对旅者开放东苑的提案。"
    prompt = build_multi_perspective_prompt(
        npc_id="npc-1",
        display_name="莫玄虚",
        factual_summary=factual,
        calendar_label="太乙1年·夏·4月·第2日",
    )
    assert "第一人称" in prompt
    assert "80" in prompt
    assert factual in prompt
    # Locked-fact instruction (D-MULTI-03)
    assert any(
        token in prompt
        for token in ("不得改写", "不要改写", "禁止改写", "不可改写", "事实摘要锁定")
    )
    assert any(token in prompt for token in ("情绪", "观感", "看法", "意见"))


def test_enqueue_multi_perspective_twelve_staggered_same_anchor():
    """D-MULTI-02/04: all 12 seats, shared eventAnchorId, staggered offsets."""
    from src.council.constants import COUNCIL_NPC_IDS
    from src.graph.personal_timeline import enqueue_multi_perspective_jobs

    factual = "庭议通过东苑开放案。"
    jobs = enqueue_multi_perspective_jobs(
        room_id="room-multi",
        event_anchor_id="wh-anchor-1",
        factual_summary=factual,
        aether_epoch_minute=10_000,
        redis_client=None,
    )
    assert len(jobs) == 12
    assert {j["npcId"] for j in jobs} == set(COUNCIL_NPC_IDS)
    assert all(j["eventAnchorId"] == "wh-anchor-1" for j in jobs)
    assert all(j["factualSummary"] == factual for j in jobs)
    assert all(j["kind"] == "multi" for j in jobs)
    offsets = [int(j["staggerOffsetGameMinutes"]) for j in jobs]
    assert len(set(offsets)) == 12
    assert max(offsets) - min(offsets) >= 180  # several SSOT game hours


def test_multi_jobs_share_anchor_divergent_bodies(monkeypatch):
    """BIO-06: after multi processing, ≥2 NPCs share event_anchor_id with different bodies."""
    from src.graph.personal_timeline import process_personal_timeline_job

    settings = Settings(llm_mock=True, game_server_url="http://127.0.0.1:2567")
    posted: list[dict] = []

    def fake_post(client, cfg, **kwargs):
        posted.append(kwargs)
        return {"ok": True, "entry": {"id": f"e-{kwargs['npc_id']}"}}

    monkeypatch.setattr(
        "src.graph.personal_timeline.post_personal_timeline_entry",
        fake_post,
    )

    factual = "议会通过对旅者开放东苑。"
    for npc_id in ("npc-1", "npc-2"):
        process_personal_timeline_job(
            MagicMock(),
            settings,
            {
                "kind": "multi",
                "jobId": f"pt-multi-room-{npc_id}",
                "roomId": "room-multi",
                "npcId": npc_id,
                "eventAnchorId": "wh-anchor-shared",
                "factualSummary": factual,
                "aetherEpochMinute": 10_000,
                "staggerOffsetGameMinutes": 0,
            },
        )

    assert len(posted) >= 2
    assert posted[0]["event_anchor_id"] == posted[1]["event_anchor_id"] == "wh-anchor-shared"
    assert posted[0]["factual_summary"] == posted[1]["factual_summary"] == factual
    assert posted[0]["body"] != posted[1]["body"]
    assert all(p["tag"] == "council" for p in posted)
    assert all(p["source"] == "llm_event" for p in posted)
