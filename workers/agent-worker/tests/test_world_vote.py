"""Tests for world_vote job pipeline (LLM_MOCK=1)."""

from __future__ import annotations

import json

import pytest

from src.config import Settings
from src.council.constants import COUNCIL_NPC_IDS, TRAVELER_KEYWORD, VOTE_YES_THRESHOLD
from src.graph.world_vote import (
    build_minutes,
    draft_proposal,
    load_context,
    pick_proposer,
    run_one_debate_round,
    run_world_vote_job,
    tally_ballots,
    VoteContext,
)


def _payload(**overrides):
    base = {
        "jobId": "vote-test-room-regular-480",
        "roomId": "test-room",
        "voteKind": "regular",
        "gameMinute": 480,
        "proposerIndex": 0,
        "debateRoundsMax": 2,
    }
    base.update(overrides)
    return base


def _ctx(**overrides) -> VoteContext:
    payload = _payload(**overrides)
    return VoteContext(
        room_id=payload["roomId"],
        vote_kind=payload["voteKind"],
        game_minute=payload["gameMinute"],
        proposer_index=payload["proposerIndex"],
        debate_rounds_max=payload["debateRoundsMax"],
        job_id=payload["jobId"],
        collective_summaries=overrides.get("collective_summaries", []),
        speak_summaries=overrides.get("speak_summaries", []),
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
    def __init__(self, responses: dict | None = None):
        self.posts: list[dict] = []
        self.gets: list[str] = []
        self._responses = responses or {}

    def get(self, url, *args, **kwargs):
        self.gets.append(url)
        if "world-vote/context" in url:
            return FakeResponse(data=self._responses.get("context", {"collectiveSummaries": [], "speakSummaries": [], "worldHistoryTail": []}))
        if "npc-relationships" in url:
            edges = self._responses.get("edges", [])
            return FakeResponse(data={"ok": True, "edges": edges})
        return FakeResponse(data={"ok": True})

    def post(self, url, *args, **kwargs):
        self.posts.append({"url": url, "json": kwargs.get("json")})
        if "world-history" in url:
            return FakeResponse(data={"ok": True, "entry": {"id": "entry-1"}})
        if "apply-deltas" in url:
            return FakeResponse(data={"ok": True, "linkedEdges": kwargs.get("json", {}).get("deltas", [])})
        return FakeResponse()


@pytest.fixture(autouse=True)
def _mock_env(monkeypatch):
    monkeypatch.setenv("LLM_MOCK", "1")


def test_pick_proposer_rotation():
    ctx = _ctx(proposerIndex=3)
    assert pick_proposer(ctx) == "npc-4"


def test_tally_yes_threshold():
    ballots = [{"npcId": f"npc-{i}", "vote": "yes" if i <= 7 else "no", "reasonZh": "r"} for i in range(2, 13)]
    status, yes, no = tally_ballots(ballots, "npc-1")
    assert yes == 6
    assert status == "accepted"

    ballots_fail = [{"npcId": f"npc-{i}", "vote": "yes" if i <= 6 else "no", "reasonZh": "r"} for i in range(2, 13)]
    status2, yes2, _ = tally_ballots(ballots_fail, "npc-1")
    assert yes2 == 5
    assert status2 == "rejected"
    assert VOTE_YES_THRESHOLD == 6


def test_draft_proposal_traveler_keyword_when_collective_present():
    ctx = _ctx(collective_summaries=["玩家帮助村民修复水渠"])
    settings = Settings(llm_mock=True)
    draft = draft_proposal(ctx, "npc-1", settings)
    assert TRAVELER_KEYWORD in draft["title"] or TRAVELER_KEYWORD in draft["proposal"]


def test_debate_round_count_regular():
    ctx = _ctx(debate_rounds_max=2)
    settings = Settings(llm_mock=True)
    run_one_debate_round(ctx, 1, "测试提案", "提案全文", settings)
    run_one_debate_round(ctx, 2, "测试提案", "提案全文", settings)
    assert len(ctx.debate_transcript) == 22  # 11 seats × 2 rounds


def test_debate_round_count_epoch():
    ctx = _ctx(debate_rounds_max=3)
    settings = Settings(llm_mock=True)
    for r in range(1, 4):
        run_one_debate_round(ctx, r, "纪元提案", "提案", settings)
    assert len(ctx.debate_transcript) == 33


def test_build_minutes_twelve_ballots():
    ballots = [
        {"npcId": f"npc-{i}", "displayName": f"N{i}", "vote": "yes", "reasonZh": "赞成"}
        for i in range(2, 13)
    ]
    minutes = build_minutes("npc-1", "提案全文", ballots)
    assert minutes["kind"] == "vote_minutes"
    assert len(minutes["ballots"]) == 12
    assert minutes["ballots"][0]["npcId"] == "npc-1"
    assert minutes["ballots"][0]["vote"] == "yes"


def test_all_twelve_seats_relationship_in_debate_prompt():
    edges = [
        {
            "npcAId": "npc-1",
            "npcBId": "npc-7",
            "affection": 30,
            "baseTag": "respect",
            "currentStatus": ["mutual_respect"],
            "historySummary": "调解成功",
        }
    ]
    ctx = _ctx()
    ctx.relationship_edges = edges
    settings = Settings(llm_mock=True)
    run_one_debate_round(ctx, 1, "标题", "提案", settings)
    assert len(ctx.debate_transcript) == 11


def test_writeback_sequence(monkeypatch):
    settings = Settings(
        llm_mock=True,
        game_server_url="http://127.0.0.1:2567",
        internal_worker_token="test-token",
    )
    client = FakeClient(
        responses={
            "context": {
                "collectiveSummaries": ["旅者协助集体事件"],
                "speakSummaries": [],
                "worldHistoryTail": [],
            },
            "edges": [],
        }
    )
    result = run_world_vote_job(_payload(), settings=settings, client=client)

    assert result["status"] in ("accepted", "rejected")
    urls = [p["url"] for p in client.posts]
    assert any("council-deliberation-sync" in u for u in urls)
    assert any("world-history" in u for u in urls)
    assert any("world-vote/complete" in u for u in urls)
    assert any("memories" in u for u in urls)

    history_post = next(p for p in client.posts if "world-history" in p["url"])
    assert history_post["json"]["entryKind"] == "vote"
    assert len(history_post["json"]["minutes"]["ballots"]) == 12

    complete_post = next(p for p in client.posts if "world-vote/complete" in p["url"])
    assert complete_post["json"]["proposerIndex"] == 0


def test_load_context_fetches_relationships():
    settings = Settings(llm_mock=True, game_server_url="http://127.0.0.1:2567")
    client = FakeClient(responses={"edges": [{"npcAId": "npc-1", "npcBId": "npc-7", "affection": 10, "baseTag": "ally", "currentStatus": [], "historySummary": ""}]})
    ctx = load_context(client, settings, _payload())
    assert len(ctx.relationship_edges) == 1


def test_vote_llm_never_zhipu():
    from src.graph.world_vote import _vote_llm_attempts

    settings = Settings(llm_mock=False, llm_provider_reflect="agnes", llm_provider_lore="agnes")
    attempts = _vote_llm_attempts(settings)
    providers = [p for p, _ in attempts]
    assert "zhipu" not in providers
    assert "agnes" in providers or "nvidia" in providers
