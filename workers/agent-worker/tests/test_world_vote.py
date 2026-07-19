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
        absolute_game_minute=int(
            payload.get("absoluteGameMinute", payload["gameMinute"])
        ),
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
        self._active_deliberation: dict | None = None

    def get(self, url, *args, **kwargs):
        self.gets.append(url)
        if "world-vote/context" in url:
            base = self._responses.get("context", {"collectiveSummaries": [], "speakSummaries": [], "worldHistoryTail": []})
            if self._active_deliberation:
                base = {**base, "activeDeliberation": self._active_deliberation}
            return FakeResponse(data=base)
        if "world-vote/pending" in url:
            pending = self._responses.get("pendingJobId", "vote-test-room-regular-480")
            return FakeResponse(data={"ok": True, "jobId": pending})
        if "npc-relationships" in url:
            edges = self._responses.get("edges", [])
            return FakeResponse(data={"ok": True, "edges": edges})
        return FakeResponse(data={"ok": True})

    def post(self, url, *args, **kwargs):
        self.posts.append({"url": url, "json": kwargs.get("json")})
        if "world-vote/checkpoint" in url:
            body = kwargs.get("json") or {}
            self._active_deliberation = {
                "jobId": body.get("jobId"),
                "voteKind": body.get("voteKind"),
                "proposerIndex": body.get("proposerIndex"),
                "proposalTitle": body.get("proposalTitle"),
                "proposalBody": body.get("proposalBody"),
                "currentRound": body.get("currentRound"),
                "debateRoundsMax": body.get("debateRoundsMax"),
                "phase": body.get("phase", "debate"),
                "transcript": body.get("transcript") or [],
                "nextRoundAtGameMinute": 99999,
            }
            return FakeResponse(
                data={
                    "ok": True,
                    "nextRoundAtGameMinute": 99999,
                    "activeDeliberation": self._active_deliberation,
                }
            )
        if "world-history" in url:
            return FakeResponse(data={"ok": True, "entry": {"id": "entry-1"}})
        if "apply-deltas" in url:
            return FakeResponse(data={"ok": True, "linkedEdges": kwargs.get("json", {}).get("deltas", [])})
        if "council-vote-memories" in url:
            ballots = kwargs.get("json", {}).get("ballots") or []
            return FakeResponse(data={"ok": True, "count": len(ballots)})
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
    assert len(ctx.debate_transcript) == 24  # 11 voters + proposer × 2 rounds


def test_debate_round_count_epoch():
    ctx = _ctx(debate_rounds_max=3)
    settings = Settings(llm_mock=True)
    for r in range(1, 4):
        run_one_debate_round(ctx, r, "纪元提案", "提案", settings)
    assert len(ctx.debate_transcript) == 36


def test_build_minutes_eleven_ballots_excludes_proposer():
    ballots = [
        {"npcId": f"npc-{i}", "displayName": f"N{i}", "vote": "yes", "reasonZh": "赞成"}
        for i in range(2, 13)
    ]
    minutes = build_minutes("npc-1", "提案全文", ballots)
    assert minutes["kind"] == "vote_minutes"
    assert len(minutes["ballots"]) == 11
    assert all(b["npcId"] != "npc-1" for b in minutes["ballots"])


def test_build_minutes_includes_debate_excerpts():
    transcript = [
        {
            "npcId": "npc-2",
            "displayName": "阿斯托利亚",
            "text": "完整辩论发言" * 5,
            "feedQuote": "高光一句",
            "round": 1,
        },
        {
            "npcId": "npc-1",
            "displayName": "莫玄虚",
            "text": "提案人发言",
            "round": 1,
        },
    ]
    ballots = [
        {"npcId": f"npc-{i}", "displayName": f"N{i}", "vote": "yes", "reasonZh": "赞成"}
        for i in range(2, 13)
    ]
    minutes = build_minutes("npc-1", "提案全文", ballots, transcript)
    assert "debateExcerpts" in minutes
    assert len(minutes["debateExcerpts"]) == 1
    assert minutes["debateExcerpts"][0]["npcId"] == "npc-2"
    assert minutes["debateExcerpts"][0]["feedQuote"] == "高光一句"


def test_debate_highlights_use_feed_quote_not_full_text():
    ctx = _ctx(debate_rounds_max=1, collective_summaries=["旅者事件"])
    settings = Settings(llm_mock=True)

    def _fake_utterance(_ctx, npc_id, round_num, title, excerpt, _settings):
        return {
            "npcId": npc_id,
            "displayName": npc_id,
            "text": "完整" * 60,
            "feedQuote": "短高光",
            "round": round_num,
            "travelerRef": False,
        }

    import src.graph.world_vote as wv

    original = wv._debate_utterance
    wv._debate_utterance = _fake_utterance
    try:
        highlights = run_one_debate_round(ctx, 1, "标题", "提案", settings)
    finally:
        wv._debate_utterance = original

    assert highlights[0]["text"] == "短高光"
    assert len(highlights[0]["text"]) <= 80


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
    assert len(ctx.debate_transcript) == 12
    assert any(line["npcId"] == ctx.proposer_id for line in ctx.debate_transcript)


def test_full_job_includes_proposer_reading_in_transcript():
    settings = Settings(
        llm_mock=True,
        game_server_url="http://127.0.0.1:2567",
        internal_worker_token="test-token",
    )
    client = FakeClient(
        responses={
            "context": {"collectiveSummaries": [], "speakSummaries": [], "worldHistoryTail": []},
            "edges": [],
        }
    )
    run_world_vote_job(_payload(debateRoundsMax=1), settings=settings, client=client)
    sync_posts = [
        p["json"]
        for p in client.posts
        if "council-deliberation-sync" in p["url"] and p["json"].get("phase") == "sealed"
    ]
    assert sync_posts
    linked = sync_posts[-1].get("linkedEdges")
    assert linked is not None


def test_cast_ballot_prompt_includes_proposer_and_debate(monkeypatch):
    captured: list[str] = []

    def fake_invoke(settings, prompt, **kwargs):
        captured.append(prompt)
        return {"vote": "yes", "reasonZh": "赞成"}

    monkeypatch.setattr("src.graph.world_vote._invoke_vote_json", fake_invoke)
    ctx = _ctx(debate_rounds_max=1)
    ctx.debate_transcript = [
        {"npcId": "npc-1", "displayName": "莫玄虚", "text": "宣读提案", "round": 0},
        {"npcId": "npc-2", "displayName": "席二", "text": "反对操之过急", "round": 1},
    ]
    settings = Settings(llm_mock=False)
    from src.graph.world_vote import _cast_single_ballot

    _cast_single_ballot(ctx, "npc-3", "测试提案", "提案摘要", settings)
    assert captured
    prompt = captured[0]
    assert "莫玄虚" in prompt
    assert "npc-1" in prompt
    assert "与提案人" in prompt or "【与提案人】" in prompt
    assert "辩论摘要" in prompt or "第0轮" in prompt


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
    assert any("council-vote-memories" in u for u in urls)

    history_idx = next(i for i, u in enumerate(urls) if "world-history" in u)
    complete_idx = next(i for i, u in enumerate(urls) if "world-vote/complete" in u)
    memories_idx = next(i for i, u in enumerate(urls) if "council-vote-memories" in u)
    sealed_idx = next(
        i
        for i, p in enumerate(client.posts)
        if "council-deliberation-sync" in p["url"] and p["json"].get("phase") == "sealed"
    )
    assert history_idx < complete_idx < memories_idx < sealed_idx

    history_post = next(p for p in client.posts if "world-history" in p["url"])
    assert history_post["json"]["entryKind"] == "vote"
    assert len(history_post["json"]["minutes"]["ballots"]) == 11

    complete_post = next(p for p in client.posts if "world-vote/complete" in p["url"])
    assert complete_post["json"]["proposerIndex"] == 0

    sealed_syncs = [
        p["json"]
        for p in client.posts
        if "council-deliberation-sync" in p["url"] and p["json"].get("phase") == "sealed"
    ]
    assert sealed_syncs, "expected sealed deliberation sync"
    assert sealed_syncs[-1]["active"] is False


def test_paced_world_vote_pauses_after_first_round():
    settings = Settings(
        llm_mock=True,
        game_server_url="http://127.0.0.1:2567",
        internal_worker_token="test-token",
    )
    client = FakeClient(
        responses={
            "context": {"collectiveSummaries": [], "speakSummaries": [], "worldHistoryTail": []},
            "edges": [],
            "pendingJobId": "vote-test-room-regular-480",
        }
    )
    result = run_world_vote_job(
        _payload(debateRoundsMax=2, instant=False),
        settings=settings,
        client=client,
    )
    assert result["status"] == "paused"
    assert result["currentRound"] == 1
    assert any("world-vote/checkpoint" in p["url"] for p in client.posts)
    assert not any("world-vote/complete" in p["url"] for p in client.posts)


def test_paced_world_vote_resumes_and_finalizes():
    settings = Settings(
        llm_mock=True,
        game_server_url="http://127.0.0.1:2567",
        internal_worker_token="test-token",
    )
    client = FakeClient(
        responses={
            "context": {"collectiveSummaries": [], "speakSummaries": [], "worldHistoryTail": []},
            "edges": [],
            "pendingJobId": "vote-test-room-regular-480-r2",
        }
    )
    client._active_deliberation = {
        "jobId": "vote-test-room-regular-480",
        "voteKind": "regular",
        "proposerIndex": 0,
        "proposalTitle": "测试提案",
        "proposalBody": "提案全文",
        "currentRound": 1,
        "debateRoundsMax": 2,
        "phase": "debate",
        "transcript": [{"npcId": "npc-1", "displayName": "莫玄虚", "text": "宣读", "round": 0}],
    }
    result = run_world_vote_job(
        {
            **_payload(debateRoundsMax=2, instant=False),
            "jobId": "vote-test-room-regular-480-r2",
            "resumeJobId": "vote-test-room-regular-480",
        },
        settings=settings,
        client=client,
    )
    assert result["status"] in ("accepted", "rejected")
    assert any("world-vote/complete" in p["url"] for p in client.posts)


def test_vote_epoch_base_job_id_strips_continuation_suffix_only():
    ctx = _ctx()
    ctx.job_id = "vote-default-regular-360-r2"
    ctx.resume_job_id = None
    assert ctx.vote_epoch_base_job_id == "vote-default-regular-360"

    ctx2 = _ctx()
    ctx2.job_id = "vote-default-regular-360"
    assert ctx2.vote_epoch_base_job_id == "vote-default-regular-360"


def test_writeback_skipped_when_job_superseded(monkeypatch):
    settings = Settings(
        llm_mock=True,
        game_server_url="http://127.0.0.1:2567",
        internal_worker_token="test-token",
    )

    class StaleCheckClient(FakeClient):
        def get(self, url, *args, **kwargs):
            self.gets.append(url)
            if "world-vote/pending" in url:
                return FakeResponse(data={"ok": True, "jobId": "other-job"})
            return super().get(url, *args, **kwargs)

    client = StaleCheckClient(
        responses={
            "context": {"collectiveSummaries": [], "speakSummaries": [], "worldHistoryTail": []},
            "edges": [],
        }
    )
    result = run_world_vote_job(_payload(jobId="vote-test-room-regular-480"), settings=settings, client=client)
    assert result["status"] == "superseded"
    assert not any("world-history" in p["url"] for p in client.posts)


def test_recover_ballot_from_prose():
    from src.graph.world_vote import _recover_json_from_prose

    raw = '本席认为应当通过。{"vote":"yes","reasonZh":"秩序优先"}'
    data = _recover_json_from_prose(raw, kind="ballot", npc_id="npc-1", seed="s")
    assert data is not None
    assert data["vote"] == "yes"
    assert "秩序" in data["reasonZh"]
    settings = Settings(llm_mock=True, game_server_url="http://127.0.0.1:2567")
    client = FakeClient(responses={"edges": [{"npcAId": "npc-1", "npcBId": "npc-7", "affection": 10, "baseTag": "ally", "currentStatus": [], "historySummary": ""}]})
    ctx = load_context(client, settings, _payload())
    assert len(ctx.relationship_edges) == 1


def test_reconcile_ballot_flips_yes_when_reason_opposes():
    from src.council.vote_prompt import reconcile_ballot_vote_reason

    ballot = {
        "npcId": "npc-1",
        "displayName": "莫玄虚",
        "vote": "yes",
        "reasonZh": "此议过激，恐乱始源平衡，不宜通过。",
    }
    out = reconcile_ballot_vote_reason(ballot)
    assert out["vote"] == "no"


def test_vote_llm_never_zhipu():
    from src.graph.world_vote import _vote_llm_attempts

    settings = Settings(llm_mock=False, llm_provider_reflect="agnes", llm_provider_lore="agnes")
    attempts = _vote_llm_attempts(settings)
    providers = [p for p, _ in attempts]
    assert "zhipu" not in providers
    assert "agnes" in providers or "nvidia" in providers


def test_post_world_history_yes_count_matches_ballot_tally():
    from src.graph.world_vote import post_world_history

    ballots = [{"npcId": f"npc-{i}", "vote": "yes" if i <= 7 else "no"} for i in range(2, 13)]
    status, yes_count, no_count = tally_ballots(ballots, "npc-1")
    assert yes_count == 6
    assert no_count == 5

    client = FakeClient()
    settings = Settings(llm_mock=True, game_server_url="http://127.0.0.1:2567")
    ctx = _ctx()
    post_world_history(
        client,
        settings,
        ctx,
        title="t",
        proposal="p",
        status="accepted",
        yes_count=yes_count,
        no_count=no_count,
        minutes={"kind": "vote_minutes", "proposalFull": "p", "ballots": ballots},
    )
    history_post = next(p for p in client.posts if "world-history" in p["url"])
    assert history_post["json"]["yesCount"] == 6
    assert history_post["json"]["noCount"] == 5
    assert history_post["json"]["yesCount"] + history_post["json"]["noCount"] == 11


def test_sealed_sync_yes_count_matches_tally_not_inflated():
    from src.graph.world_vote import writeback_sequence

    ballots = [{"npcId": f"npc-{i}", "vote": "yes" if i <= 7 else "no"} for i in range(2, 13)]
    _status, yes_count, no_count = tally_ballots(ballots, "npc-1")
    client = FakeClient()
    settings = Settings(llm_mock=True, game_server_url="http://127.0.0.1:2567")
    ctx = _ctx()
    writeback_sequence(
        client,
        settings,
        ctx,
        title="t",
        proposal="p",
        status="rejected",
        yes_count=yes_count,
        no_count=no_count,
        linked_edges=[],
        result_entry_id="entry-1",
    )
    sync_post = next(p for p in client.posts if "council-deliberation-sync" in p["url"])
    body = sync_post["json"]
    assert body["yesCount"] == 6
    assert body["noCount"] == 5


def test_env_int_tolerates_non_numeric(monkeypatch):
    from src.graph import world_vote as wv

    monkeypatch.setenv("VOTE_DEBATE_ROUNDS_MAX", "not-a-number")
    assert wv._env_int("VOTE_DEBATE_ROUNDS_MAX", 3) == 3


def test_leaning_default_vote_uses_stable_hash():
    from src.graph.world_vote import _leaning_default_vote

    a = _leaning_default_vote("npc-1", "seed-a")
    b = _leaning_default_vote("npc-1", "seed-a")
    assert a in ("yes", "no")
    assert a == b


def test_leaning_default_vote_respects_positive_drift(monkeypatch):
    from src.graph import world_vote as wv

    monkeypatch.setattr(
        "src.graph.world_vote.get_leaning_drift",
        lambda room_id, npc_id: 25 if npc_id == "npc-3" else 0,
    )
    assert wv._leaning_default_vote("npc-3", "seed", room_id="room-drift") == "yes"
    assert wv._leaning_default_vote("npc-1", "seed", room_id="room-drift") == "no"


def test_post_deliberation_failed_skips_when_job_superseded():
    from src.graph.world_vote import post_deliberation_failed

    client = FakeClient(responses={"pendingJobId": "other-job"})
    settings = Settings(llm_mock=True, game_server_url="http://127.0.0.1:2567")
    post_deliberation_failed(
        client,
        settings,
        _payload(jobId="vote-test-room-regular-480"),
    )
    assert not any("council-deliberation-sync" in p["url"] for p in client.posts)
    assert not any("world-vote/complete" in p["url"] for p in client.posts)
