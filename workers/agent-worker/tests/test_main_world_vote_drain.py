"""World-vote drain fairness after lore / idle loops."""

from __future__ import annotations

import json
from unittest.mock import MagicMock

from src.config import Settings
from src.main import WORLD_VOTE_BRIDGE_LIST_KEY, drain_one_world_vote_job


def test_drain_one_world_vote_job_processes_rpop_payload(monkeypatch):
    payload = {
        "jobId": "vote-room-drain-regular-480",
        "roomId": "room-drain",
        "voteKind": "regular",
        "gameMinute": 480,
        "proposerIndex": 0,
        "debateRoundsMax": 2,
    }
    r = MagicMock()
    r.llen.return_value = 0
    r.rpop.return_value = json.dumps(payload).encode()

    calls: list[dict] = []

    def fake_process(client, settings, body):
        calls.append(body)

    monkeypatch.setattr("src.main._is_speak_in_progress", lambda: False)
    monkeypatch.setattr("src.main.process_world_vote_job_wrapper", fake_process)

    settings = Settings(llm_mock=True, game_server_url="http://127.0.0.1:2567")
    client = MagicMock()
    handled = drain_one_world_vote_job(r, client, settings)

    assert handled is True
    r.rpop.assert_called_once_with(WORLD_VOTE_BRIDGE_LIST_KEY)
    assert calls == [payload]


def test_drain_one_world_vote_job_defers_when_speak_backlog(monkeypatch):
    r = MagicMock()
    r.llen.return_value = 2
    monkeypatch.setattr("src.main._is_speak_in_progress", lambda: False)

    settings = Settings(llm_mock=True, game_server_url="http://127.0.0.1:2567")
    handled = drain_one_world_vote_job(r, MagicMock(), settings)

    assert handled is False
    r.rpop.assert_not_called()
