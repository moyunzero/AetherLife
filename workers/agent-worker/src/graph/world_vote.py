"""Council world-vote job: propose → debate → ballot → writeback (VOTE-02…05, VOTE-09)."""

from __future__ import annotations

import json
import os
import re
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from typing import Any

import httpx

from src.config import Settings, get_settings
from src.council.constants import (
    COUNCIL_MEMORY_PLAYER_ID,
    COUNCIL_NPC_IDS,
    TRAVELER_KEYWORD,
    VOTE_YES_THRESHOLD,
)
from src.council.registry import display_name, get_persona
from src.council.relationship_deltas import compute_relationship_deltas
from src.council.relationship_prompt import (
    format_all_seats_relationship_context,
    format_relationship_block_for_npc,
)
from src.graph.lore_loop import _extract_json_object, _invoke_lore_llm, _lore_provider_attempts
from src.http_json import create_http_client

FORBIDDEN_VOTE_PROVIDERS = frozenset({"zhipu"})


def _game_headers(settings: Settings) -> dict[str, str]:
    headers: dict[str, str] = {"Content-Type": "application/json"}
    if settings.internal_worker_token:
        headers["Authorization"] = f"Bearer {settings.internal_worker_token}"
    return headers


def _vote_llm_attempts(settings: Settings) -> list[tuple[str, str]]:
    """Reflect/lore providers only — never zhipu speak slot."""
    attempts: list[tuple[str, str]] = []
    reflect_provider = (settings.llm_provider_reflect or "agnes").strip().lower()
    reflect_model = settings.llm_model_reflect or "agnes-2.0-flash"
    if reflect_provider not in FORBIDDEN_VOTE_PROVIDERS:
        attempts.append((reflect_provider, reflect_model))

    lore_provider = (settings.llm_provider_lore or settings.llm_provider_reflect or "agnes").strip().lower()
    lore_model = settings.llm_model_lore_t0 or settings.llm_model_reflect or reflect_model
    if lore_provider not in FORBIDDEN_VOTE_PROVIDERS:
        pair = (lore_provider, lore_model)
        if pair not in attempts:
            attempts.append(pair)

    nvidia_model = settings.llm_model_nvidia_fast or "meta/llama-3.3-70b-instruct"
    if ("nvidia", nvidia_model) not in attempts:
        attempts.append(("nvidia", nvidia_model))

    return [a for a in attempts if a[0] not in FORBIDDEN_VOTE_PROVIDERS]


def _invoke_vote_llm(settings: Settings, prompt: str) -> str:
    if settings.llm_mock or os.getenv("LLM_MOCK") == "1":
        return _mock_llm_response(prompt)
    last_exc: BaseException | None = None
    for provider, model in _vote_llm_attempts(settings):
        try:
            return _invoke_lore_llm(settings, provider, model, prompt)
        except Exception as exc:
            last_exc = exc
            print(f"vote LLM provider={provider} failed: {exc}", file=sys.stderr)
            continue
    assert last_exc is not None
    raise last_exc


def _mock_llm_response(prompt: str) -> str:
    if "提案" in prompt or "title" in prompt:
        traveler = TRAVELER_KEYWORD if ("collective" in prompt or "speak" in prompt or "旅者素材" in prompt) else ""
        ref = f"据近期{TRAVELER_KEYWORD}言行，" if traveler else ""
        return json.dumps(
            {
                "title": f"{ref}关于加强始源区秩序协作",
                "proposal": f"{ref}本席提议在融合世界建立更清晰的议事协调机制，以平衡各位面代表的利益。",
            },
            ensure_ascii=False,
        )
    if "辩论" in prompt or "debate" in prompt.lower():
        return json.dumps(
            {"text": "依本席之见，此议需再斟酌；反对操之过急。", "stance": "oppose"},
            ensure_ascii=False,
        )
    if "表决" in prompt or "vote" in prompt.lower():
        return json.dumps({"vote": "yes", "reasonZh": "总体利大于弊，赞成。"}, ensure_ascii=False)
    return "{}"


@dataclass
class VoteContext:
    room_id: str
    vote_kind: str
    game_minute: int
    proposer_index: int
    debate_rounds_max: int
    job_id: str
    collective_summaries: list[str] = field(default_factory=list)
    speak_summaries: list[str] = field(default_factory=list)
    world_history_tail: list[str] = field(default_factory=list)
    relationship_edges: list[dict[str, Any]] = field(default_factory=list)
    debate_transcript: list[dict[str, Any]] = field(default_factory=list)

    @property
    def proposer_id(self) -> str:
        idx = self.proposer_index % len(COUNCIL_NPC_IDS)
        return COUNCIL_NPC_IDS[idx]

    @property
    def vote_epoch(self) -> str:
        year = max(1, self.game_minute // 1440 + 1)
        return f"vote-{self.room_id}-y{year}-{self.game_minute}"


def pick_proposer(ctx: VoteContext) -> str:
    return ctx.proposer_id


def load_context(
    client: httpx.Client,
    settings: Settings,
    payload: dict[str, Any],
) -> VoteContext:
    room_id = str(payload.get("roomId") or "default")
    ctx = VoteContext(
        room_id=room_id,
        vote_kind=str(payload.get("voteKind") or "regular"),
        game_minute=int(payload.get("gameMinute") or 0),
        proposer_index=int(payload.get("proposerIndex") or 0),
        debate_rounds_max=int(payload.get("debateRoundsMax") or 2),
        job_id=str(payload.get("jobId") or "unknown"),
    )

    base = settings.game_server_url.rstrip("/")

    try:
        res = client.get(
            f"{base}/internal/rooms/{room_id}/world-vote/context",
            headers=_game_headers(settings),
            timeout=30.0,
        )
        if res.status_code == 200:
            data = res.json()
            ctx.collective_summaries = list(data.get("collectiveSummaries") or [])
            ctx.speak_summaries = list(data.get("speakSummaries") or [])
            ctx.world_history_tail = list(data.get("worldHistoryTail") or [])
    except Exception as exc:
        print(f"world-vote context fetch skipped: {exc}", file=sys.stderr)

    try:
        res = client.get(
            f"{base}/internal/rooms/{room_id}/npc-relationships",
            headers=_game_headers(settings),
            timeout=30.0,
        )
        res.raise_for_status()
        data = res.json()
        ctx.relationship_edges = list(data.get("edges") or [])
    except Exception as exc:
        print(f"npc-relationships fetch failed: {exc}", file=sys.stderr)

    return ctx


def _has_traveler_material(ctx: VoteContext) -> bool:
    return bool(ctx.collective_summaries or ctx.speak_summaries)


def draft_proposal(ctx: VoteContext, proposer_id: str, settings: Settings) -> dict[str, str]:
    persona = get_persona(proposer_id)
    name = persona["displayName"] if persona else proposer_id
    traveler_block = ""
    if _has_traveler_material(ctx):
        parts = []
        if ctx.collective_summaries:
            parts.append("集体事件：" + "；".join(ctx.collective_summaries[:5]))
        if ctx.speak_summaries:
            parts.append("speak摘要：" + "；".join(ctx.speak_summaries[:5]))
        traveler_block = "旅者素材（subtle融入口吻，不具名）：\n" + "\n".join(parts)

    history_block = ""
    if ctx.world_history_tail:
        history_block = "近期编年史：" + "；".join(ctx.world_history_tail[:3])

    prompt = (
        f"你是议会提案人【{name}】。写一份中文廷议提案 JSON。\n"
        f"审议类型：{ctx.vote_kind}。\n"
        f"{history_block}\n"
        f"{traveler_block}\n"
        "输出 JSON：title(≤80字), proposal(≤600字)。"
        "若有旅者素材，proposal 中 subtle 提及「据近期旅者言行」但不具名玩家。"
    )

    if settings.llm_mock or os.getenv("LLM_MOCK") == "1":
        raw = _mock_llm_response(prompt)
    else:
        raw = _invoke_vote_llm(settings, prompt)

    data = _extract_json_object(raw)
    title = str(data.get("title") or "议会提案").strip()[:120]
    proposal = str(data.get("proposal") or title).strip()[:8000]
    return {"title": title, "proposal": proposal}


def _debate_utterance(
    ctx: VoteContext,
    npc_id: str,
    round_num: int,
    title: str,
    proposal_excerpt: str,
    settings: Settings,
) -> dict[str, Any]:
    persona = get_persona(npc_id)
    name = persona["displayName"] if persona else npc_id
    rel_block = format_relationship_block_for_npc(npc_id, ctx.relationship_edges)
    prompt = (
        f"议会辩论第{round_num}轮。提案标题：{title}\n"
        f"提案摘要：{proposal_excerpt[:200]}\n"
        f"发言人：{name}({npc_id})\n"
        f"debateStyle：{persona['debateStyle'] if persona else ''}\n"
        f"运行时关系：\n{rel_block}\n"
        "输出 JSON：text(≤120字中文发言), stance(support|oppose|neutral)。"
    )
    raw = _invoke_vote_llm(settings, prompt)
    data = _extract_json_object(raw)
    text = str(data.get("text") or "本席暂无补充。").strip()[:200]
    return {"npcId": npc_id, "displayName": name, "text": text, "round": round_num}


def run_one_debate_round(
    ctx: VoteContext,
    round_num: int,
    title: str,
    proposal: str,
    settings: Settings,
) -> list[dict[str, Any]]:
    """Run one debate round; return 2–3 highlight quotes for feed sync."""
    excerpt = proposal[:300]
    all_seats = format_all_seats_relationship_context(ctx.relationship_edges)
    assert set(all_seats.keys()) == set(COUNCIL_NPC_IDS)

    round_lines: list[dict[str, Any]] = []
    for npc_id in COUNCIL_NPC_IDS:
        if npc_id == ctx.proposer_id:
            continue
        line = _debate_utterance(ctx, npc_id, round_num, title, excerpt, settings)
        ctx.debate_transcript.append(line)
        round_lines.append(line)

    highlights: list[dict[str, Any]] = []
    for line in round_lines[:3]:
        highlights.append(
            {
                "kind": "quote",
                "npcId": line["npcId"],
                "displayName": line["displayName"],
                "text": line["text"][:80],
                "travelerRef": TRAVELER_KEYWORD in line["text"],
            }
        )
    return highlights


def _cast_single_ballot(
    ctx: VoteContext,
    npc_id: str,
    title: str,
    proposal_excerpt: str,
    settings: Settings,
) -> dict[str, Any]:
    persona = get_persona(npc_id)
    name = persona["displayName"] if persona else npc_id
    rel_block = format_relationship_block_for_npc(npc_id, ctx.relationship_edges)
    prompt = (
        f"议会最终表决。提案：{title}\n摘要：{proposal_excerpt[:200]}\n"
        f"表决人：{name}({npc_id})\n"
        f"投票倾向：{persona['votingLeaning'] if persona else 'swing'}\n"
        f"运行时关系：\n{rel_block}\n"
        "输出 JSON：vote(yes|no), reasonZh(≤80字)。"
    )
    raw = _invoke_vote_llm(settings, prompt)
    data = _extract_json_object(raw)
    vote = str(data.get("vote") or "no").lower()
    if vote not in ("yes", "no"):
        vote = "yes" if "赞成" in vote or vote == "y" else "no"
    reason = str(data.get("reasonZh") or "依本席判断。").strip()[:120]
    return {"npcId": npc_id, "displayName": name, "vote": vote, "reasonZh": reason}


def cast_ballots(
    ctx: VoteContext,
    title: str,
    proposal: str,
    settings: Settings,
) -> list[dict[str, Any]]:
    excerpt = proposal[:300]
    non_proposer = [nid for nid in COUNCIL_NPC_IDS if nid != ctx.proposer_id]
    ballots: list[dict[str, Any]] = []

    if settings.llm_mock or os.getenv("LLM_MOCK") == "1":
        for i, npc_id in enumerate(non_proposer):
            vote = "yes" if i < 7 else "no"
            ballots.append(
                {
                    "npcId": npc_id,
                    "displayName": display_name(npc_id),
                    "vote": vote,
                    "reasonZh": "mock 表决理由。",
                }
            )
        return ballots

    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = {
            pool.submit(_cast_single_ballot, ctx, npc_id, title, excerpt, settings): npc_id
            for npc_id in non_proposer
        }
        for fut in as_completed(futures):
            ballots.append(fut.result())

    ballots.sort(key=lambda b: COUNCIL_NPC_IDS.index(b["npcId"]))
    return ballots


def tally_ballots(ballots: list[dict[str, Any]], proposer_id: str) -> tuple[str, int, int]:
    """Tally 11 non-proposer ballots; yes >= 6 → accepted."""
    voters = [b for b in ballots if b["npcId"] != proposer_id]
    yes_count = sum(1 for b in voters if b["vote"] == "yes")
    no_count = sum(1 for b in voters if b["vote"] == "no")
    status = "accepted" if yes_count >= VOTE_YES_THRESHOLD else "rejected"
    return status, yes_count, no_count


def build_minutes(
    proposer_id: str,
    proposal: str,
    ballots: list[dict[str, Any]],
) -> dict[str, Any]:
    proposer_ballot = {
        "npcId": proposer_id,
        "displayName": display_name(proposer_id),
        "vote": "yes",
        "reasonZh": "提案人当然附议本席所提方案。",
    }
    all_ballots = [proposer_ballot] + [b for b in ballots if b["npcId"] != proposer_id]
    all_ballots.sort(key=lambda b: COUNCIL_NPC_IDS.index(b["npcId"]))
    return {
        "kind": "vote_minutes",
        "proposalFull": proposal,
        "ballots": all_ballots,
    }


def post_deliberation_sync(
    client: httpx.Client,
    settings: Settings,
    ctx: VoteContext,
    payload: dict[str, Any],
) -> None:
    url = f"{settings.game_server_url.rstrip('/')}/internal/rooms/{ctx.room_id}/council-deliberation-sync"
    res = client.post(url, json=payload, headers=_game_headers(settings), timeout=15.0)
    res.raise_for_status()


def post_world_history(
    client: httpx.Client,
    settings: Settings,
    ctx: VoteContext,
    *,
    title: str,
    proposal: str,
    status: str,
    yes_count: int,
    no_count: int,
    minutes: dict[str, Any],
) -> dict[str, Any]:
    url = f"{settings.game_server_url.rstrip('/')}/internal/rooms/{ctx.room_id}/world-history"
    body = {
        "entryKind": "vote",
        "status": status,
        "title": title,
        "proposal": proposal,
        "proposerDisplayName": display_name(ctx.proposer_id),
        "proposerNpcId": ctx.proposer_id,
        "minutes": minutes,
        "gameMinuteSnapshot": ctx.game_minute,
        "yesCount": yes_count + 1,
        "noCount": no_count,
        "voteEpoch": ctx.vote_epoch,
        "mapRoomId": ctx.room_id,
    }
    res = client.post(url, json=body, headers=_game_headers(settings), timeout=30.0)
    res.raise_for_status()
    return res.json()


def append_council_memories(
    client: httpx.Client,
    settings: Settings,
    ctx: VoteContext,
    ballots: list[dict[str, Any]],
) -> None:
    url_base = f"{settings.game_server_url.rstrip('/')}/internal/rooms/{ctx.room_id}/memories"
    for ballot in ballots:
        text = f"廷议表决：{ballot['vote']} — {ballot['reasonZh']}"
        body = {
            "text": text,
            "npcId": ballot["npcId"],
            "playerId": COUNCIL_MEMORY_PLAYER_ID,
            "role": "npc",
            "importance": 0.6,
        }
        res = client.post(url_base, json=body, headers=_game_headers(settings), timeout=15.0)
        res.raise_for_status()


def apply_relationship_deltas(
    client: httpx.Client,
    settings: Settings,
    ctx: VoteContext,
    debate_transcript: list[dict[str, Any]],
    ballots: list[dict[str, Any]],
) -> list[dict[str, str]]:
    deltas = compute_relationship_deltas(
        debate_transcript,  # type: ignore[arg-type]
        ballots,  # type: ignore[arg-type]
        ctx.proposer_id,
        seed=hash(ctx.job_id) % (2**31),
    )
    if not deltas:
        return []
    url = f"{settings.game_server_url.rstrip('/')}/internal/rooms/{ctx.room_id}/npc-relationships/apply-deltas"
    body = {"deltas": deltas, "voteEpoch": ctx.vote_epoch}
    res = client.post(url, json=body, headers=_game_headers(settings), timeout=30.0)
    res.raise_for_status()
    data = res.json()
    return list(data.get("linkedEdges") or [])


def post_vote_complete(
    client: httpx.Client,
    settings: Settings,
    ctx: VoteContext,
) -> None:
    url = f"{settings.game_server_url.rstrip('/')}/internal/rooms/{ctx.room_id}/world-vote/complete"
    body = {
        "gameMinute": ctx.game_minute,
        "voteKind": ctx.vote_kind,
        "proposerIndex": ctx.proposer_index,
        "jobId": ctx.job_id,
    }
    res = client.post(url, json=body, headers=_game_headers(settings), timeout=15.0)
    res.raise_for_status()


def writeback_sequence(
    client: httpx.Client,
    settings: Settings,
    ctx: VoteContext,
    *,
    title: str,
    proposal: str,
    status: str,
    yes_count: int,
    no_count: int,
    minutes: dict[str, Any],
    ballots: list[dict[str, Any]],
    linked_edges: list[dict[str, str]],
    result_entry_id: str | None = None,
) -> None:
    post_deliberation_sync(
        client,
        settings,
        ctx,
        {
            "active": True,
            "voteKind": ctx.vote_kind,
            "phase": "sealed",
            "round": ctx.debate_rounds_max,
            "roundTotal": ctx.debate_rounds_max,
            "proposalTitle": title,
            "linkedEdges": linked_edges,
            "resultEntryId": result_entry_id,
            "yesCount": yes_count + 1,
            "noCount": no_count,
            "status": status,
            "clearFeed": True,
        },
    )
    append_council_memories(client, settings, ctx, minutes["ballots"])
    post_vote_complete(client, settings, ctx)


def run_world_vote_job(
    payload: dict[str, Any],
    *,
    settings: Settings | None = None,
    client: httpx.Client | None = None,
) -> dict[str, Any]:
    cfg = settings or get_settings()
    owns_client = client is None
    http = client or create_http_client()
    try:
        ctx = load_context(http, cfg, payload)
        proposer_id = pick_proposer(ctx)

        post_deliberation_sync(
            http,
            cfg,
            ctx,
            {
                "active": True,
                "voteKind": ctx.vote_kind,
                "phase": "proposal",
                "round": 0,
                "roundTotal": ctx.debate_rounds_max,
            },
        )

        draft = draft_proposal(ctx, proposer_id, cfg)
        title = draft["title"]
        proposal = draft["proposal"]

        post_deliberation_sync(
            http,
            cfg,
            ctx,
            {
                "active": True,
                "voteKind": ctx.vote_kind,
                "phase": "proposal",
                "round": 0,
                "roundTotal": ctx.debate_rounds_max,
                "proposalTitle": title,
            },
        )

        for round_num in range(1, ctx.debate_rounds_max + 1):
            highlights = run_one_debate_round(ctx, round_num, title, proposal, cfg)
            post_deliberation_sync(
                http,
                cfg,
                ctx,
                {
                    "active": True,
                    "voteKind": ctx.vote_kind,
                    "phase": "debate",
                    "round": round_num,
                    "roundTotal": ctx.debate_rounds_max,
                    "proposalTitle": title,
                    "feedDelta": highlights,
                },
            )

        ballots = cast_ballots(ctx, title, proposal, cfg)
        status, yes_count, no_count = tally_ballots(ballots, proposer_id)
        minutes = build_minutes(proposer_id, proposal, ballots)

        vote_feed = [
            {
                "kind": "vote",
                "npcId": b["npcId"],
                "displayName": b["displayName"],
                "vote": b["vote"],
                "reasonZh": b.get("reasonZh", "")[:120],
            }
            for b in minutes["ballots"]
        ]
        post_deliberation_sync(
            http,
            cfg,
            ctx,
            {
                "active": True,
                "voteKind": ctx.vote_kind,
                "phase": "vote",
                "round": ctx.debate_rounds_max,
                "roundTotal": ctx.debate_rounds_max,
                "proposalTitle": title,
                "feedDelta": vote_feed,
            },
        )

        history_res = post_world_history(
            http,
            cfg,
            ctx,
            title=title,
            proposal=proposal,
            status=status,
            yes_count=yes_count,
            no_count=no_count,
            minutes=minutes,
        )
        entry_id = (history_res.get("entry") or {}).get("id")

        linked_edges = apply_relationship_deltas(http, cfg, ctx, ctx.debate_transcript, ballots)

        writeback_sequence(
            http,
            cfg,
            ctx,
            title=title,
            proposal=proposal,
            status=status,
            yes_count=yes_count,
            no_count=no_count,
            minutes=minutes,
            ballots=ballots,
            linked_edges=linked_edges,
            result_entry_id=entry_id,
        )

        return {
            "status": status,
            "yesCount": yes_count,
            "noCount": no_count,
            "title": title,
            "proposerId": proposer_id,
            "debateRounds": ctx.debate_rounds_max,
        }
    finally:
        if owns_client:
            http.close()


def process_world_vote_job(
    client: httpx.Client,
    settings: Settings,
    payload: dict[str, Any],
) -> None:
    job_id = payload.get("jobId", "unknown")
    print(f"world-vote job received jobId={job_id} room={payload.get('roomId')}", file=sys.stderr)
    run_world_vote_job(payload, settings=settings, client=client)
