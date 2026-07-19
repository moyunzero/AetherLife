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
