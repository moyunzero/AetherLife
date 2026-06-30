"""Council world-vote job: propose → debate → ballot → writeback (VOTE-02…05, VOTE-09)."""

from __future__ import annotations

import json
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from typing import Any

import httpx

from src.config import Settings, get_settings
from src.council.constants import (
    COUNCIL_NPC_IDS,
    TRAVELER_KEYWORD,
    VOTE_YES_THRESHOLD,
)


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)) or default)
    except ValueError:
        return default


DEBATE_ROUNDS_MAX = max(1, min(5, _env_int("VOTE_DEBATE_ROUNDS_MAX", 5)))
DEBATE_ROUND_GAME_MINUTES = max(1, _env_int("VOTE_DEBATE_ROUND_GAME_DAYS", 1) * 1440)

from src.council.leaning_drift import effective_voting_leaning, get_leaning_drift
from src.council.registry import display_name, get_persona
from src.council.relationship_deltas import compute_relationship_deltas, filter_linked_edges_for_ui
from src.council.relationship_prompt import (
    format_all_seats_relationship_context,
    format_debate_transcript_summary,
    format_proposer_relationship,
    format_relationship_block_for_npc,
)
from src.council.vote_prompt import (
    COUNCIL_VOTE_SETTING,
    ballot_prompt_instructions,
    build_vote_persona_block,
    clamp_feed_quote,
    clamp_full_debate,
    debate_output_instructions,
    finalize_deliberation_sync_payload,
    non_empty_council_line,
    normalize_linked_edges,
    proposal_prompt_instructions,
    reconcile_ballot_vote_reason,
    sanitize_council_text,
)
from src.graph.lore_loop import _extract_json_object, _invoke_lore_llm, _lore_provider_attempts
from src.graph.stable_string_hash import stable_string_hash
from src.http_json import create_http_client

FORBIDDEN_VOTE_PROVIDERS = frozenset({"zhipu"})

_VOTE_JSON_SUFFIX = (
    "\n\n只输出一个 JSON 对象，不要 markdown 代码块或任何解释。"
    '示例：{"vote":"yes","reasonZh":"理由不超过80字"}'
)


def _leaning_default_vote(npc_id: str, seed: str, *, room_id: str | None = None) -> str:
    persona = get_persona(npc_id)
    if not persona:
        return "no"
    drift = get_leaning_drift(room_id, npc_id) if room_id else 0
    leaning = effective_voting_leaning(npc_id, drift)
    if leaning == "for":
        return "yes"
    if leaning == "against":
        return "no"
    return "yes" if stable_string_hash(f"{npc_id}:{seed}") % 2 == 0 else "no"


def _recover_json_from_prose(
    raw: str,
    *,
    kind: str,
    npc_id: str = "",
    seed: str = "",
    room_id: str | None = None,
) -> dict[str, Any] | None:
    text = (raw or "").strip()
    if not text:
        return None
    if kind == "ballot":
        vote_match = re.search(r'"vote"\s*:\s*"(yes|no)"', text, re.I)
        reason_match = re.search(r'"reasonZh"\s*:\s*"([^"]{1,120})"', text)
        vote: str | None = vote_match.group(1).lower() if vote_match else None
        if not vote:
            if re.search(r"赞成|附议|支持通过", text):
                vote = "yes"
            elif re.search(r"反对|否决|不宜通过", text):
                vote = "no"
        if not vote and npc_id:
            vote = _leaning_default_vote(npc_id, seed, room_id=room_id)
        if not vote:
            return None
        reason = reason_match.group(1).strip() if reason_match else "依本席判断。"
        return {"vote": vote, "reasonZh": reason[:120]}
    if kind == "debate":
        full_match = re.search(r'"fullText"\s*:\s*"([^"]{1,200})"', text)
        feed_match = re.search(r'"feedQuote"\s*:\s*"([^"]{1,80})"', text)
        text_match = re.search(r'"text"\s*:\s*"([^"]{1,200})"', text)
        stance_match = re.search(r'"stance"\s*:\s*"(support|oppose|neutral)"', text, re.I)
        full_raw = (
            full_match.group(1).strip()
            if full_match
            else (text_match.group(1).strip() if text_match else "")
        )
        if full_raw:
            out: dict[str, Any] = {
                "fullText": full_raw[:200],
                "stance": (stance_match.group(1).lower() if stance_match else "neutral"),
            }
            if feed_match:
                out["feedQuote"] = feed_match.group(1).strip()[:80]
            return out
    if kind == "proposal":
        title_match = re.search(r'"title"\s*:\s*"([^"]{1,120})"', text)
        proposal_match = re.search(r'"proposal"\s*:\s*"([^"]{1,800})"', text)
        if title_match and proposal_match:
            return {
                "title": title_match.group(1).strip()[:120],
                "proposal": proposal_match.group(1).strip()[:8000],
            }
    return None


def _post_with_retry(
    client: httpx.Client,
    url: str,
    *,
    json_body: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
    timeout: float = 60.0,
    attempts: int = 3,
    backoff_s: float = 2.0,
) -> httpx.Response:
    last_exc: Exception | None = None
    for attempt in range(attempts):
        try:
            res = client.post(url, json=json_body, headers=headers, timeout=timeout)
            res.raise_for_status()
            return res
        except Exception as exc:
            last_exc = exc
            if attempt < attempts - 1:
                time.sleep(backoff_s * (attempt + 1))
    assert last_exc is not None
    raise last_exc


def is_job_still_pending(
    client: httpx.Client,
    settings: Settings,
    ctx: VoteContext,
) -> bool:
    """Return False when a newer world-vote job superseded this one."""
    base = settings.game_server_url.rstrip("/")
    url = f"{base}/internal/rooms/{ctx.room_id}/world-vote/pending"
    try:
        res = client.get(url, headers=_game_headers(settings), timeout=10.0)
        if res.status_code != 200:
            return True
        data = res.json()
        pending = data.get("jobId")
        if pending is None:
            return True
        return str(pending) == ctx.job_id
    except Exception as exc:
        print(f"world-vote pending check skipped: {exc}", file=sys.stderr)
        return True


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


def _invoke_vote_json(
    settings: Settings,
    prompt: str,
    *,
    fallback: dict[str, Any] | None = None,
    recover_kind: str = "",
    recover_npc_id: str = "",
    recover_seed: str = "",
    recover_room_id: str | None = None,
) -> dict[str, Any]:
    """Call vote LLM and parse JSON; retry once with a stricter suffix on parse failure."""
    if settings.llm_mock or os.getenv("LLM_MOCK") == "1":
        return _extract_json_object(_mock_llm_response(prompt))

    last_err: BaseException | None = None
    last_raw = ""
    for attempt in range(2):
        p = prompt if attempt == 0 else prompt + _VOTE_JSON_SUFFIX
        try:
            last_raw = _invoke_vote_llm(settings, p)
            return _extract_json_object(last_raw)
        except ValueError as exc:
            last_err = exc
            print(f"vote JSON parse attempt {attempt + 1} failed: {exc}", file=sys.stderr)
            continue
    if last_raw.strip():
        try:
            return _extract_json_object(last_raw)
        except ValueError:
            recovered = _recover_json_from_prose(
                last_raw,
                kind=recover_kind,
                npc_id=recover_npc_id,
                seed=recover_seed,
                room_id=recover_room_id,
            )
            if recovered:
                print("vote JSON parse recovered fields from prose", file=sys.stderr)
                return recovered
    if fallback is not None:
        print("vote JSON parse using fallback payload", file=sys.stderr)
        return fallback
    assert last_err is not None
    raise last_err


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
            {
                "fullText": "依本席之见，此议需再斟酌；反对操之过急。",
                "feedQuote": "此议需再斟酌。",
                "stance": "oppose",
            },
            ensure_ascii=False,
        )
    if "表决" in prompt or "vote" in prompt.lower():
        return json.dumps({"vote": "yes", "reasonZh": "依本席所司，此议可落地，赞成。"}, ensure_ascii=False)
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
    instant_debate: bool = True
    resume_job_id: str | None = None
    deliberation_checkpoint: dict[str, Any] | None = None

    @property
    def proposer_id(self) -> str:
        idx = self.proposer_index % len(COUNCIL_NPC_IDS)
        return COUNCIL_NPC_IDS[idx]

    @property
    def vote_epoch_base_job_id(self) -> str:
        if self.resume_job_id:
            return self.resume_job_id
        base = self.job_id
        if re.search(r"-r\d+$", base):
            return re.sub(r"-r\d+$", "", base)
        return base

    @property
    def vote_epoch(self) -> str:
        year = max(1, self.game_minute // 1440 + 1)
        return f"vote-{self.room_id}-y{year}-{self.game_minute}-{self.vote_epoch_base_job_id}"


def pick_proposer(ctx: VoteContext) -> str:
    return ctx.proposer_id


def load_context(
    client: httpx.Client,
    settings: Settings,
    payload: dict[str, Any],
) -> VoteContext:
    room_id = str(payload.get("roomId") or "default")
    resume_raw = payload.get("resumeJobId")
    ctx = VoteContext(
        room_id=room_id,
        vote_kind=str(payload.get("voteKind") or "regular"),
        game_minute=int(payload.get("gameMinute") or 0),
        proposer_index=int(payload.get("proposerIndex") or 0),
        debate_rounds_max=max(1, min(DEBATE_ROUNDS_MAX, int(payload.get("debateRoundsMax") or 2))),
        job_id=str(payload.get("jobId") or "unknown"),
        instant_debate=payload.get("instant") is not False,
        resume_job_id=str(resume_raw) if resume_raw else None,
    )

    base = settings.game_server_url.rstrip("/")

    try:
        res = client.get(
            f"{base}/internal/rooms/{room_id}/world-vote/context",
            headers=_game_headers(settings),
            timeout=60.0,
        )
        if res.status_code == 200:
            data = res.json()
            ctx.collective_summaries = list(data.get("collectiveSummaries") or [])
            ctx.speak_summaries = list(data.get("speakSummaries") or [])
            ctx.world_history_tail = list(data.get("worldHistoryTail") or [])
            ck = data.get("activeDeliberation")
            if ctx.resume_job_id and isinstance(ck, dict) and ck.get("jobId") == ctx.resume_job_id:
                ctx.deliberation_checkpoint = ck
                ctx.debate_transcript = list(ck.get("transcript") or [])
                ctx.proposer_index = int(ck.get("proposerIndex") or ctx.proposer_index)
                ctx.debate_rounds_max = max(
                    1,
                    min(DEBATE_ROUNDS_MAX, int(ck.get("debateRoundsMax") or ctx.debate_rounds_max)),
                )
                ctx.vote_kind = str(ck.get("voteKind") or ctx.vote_kind)
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
    persona_block = build_vote_persona_block(proposer_id, ctx.relationship_edges)
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
        f"{COUNCIL_VOTE_SETTING}\n"
        f"{proposal_prompt_instructions(is_proposer=True)}\n"
        f"审议类型：{ctx.vote_kind}。\n"
        f"{persona_block}\n"
        f"{history_block}\n"
        f"{traveler_block}\n"
        "输出 JSON：title(≤80字), proposal(≤600字)。"
        "若有旅者素材，proposal 中 subtle 提及「据近期旅者言行」但不具名玩家。"
        f'{_VOTE_JSON_SUFFIX} 示例：{{"title":"标题","proposal":"正文"}}'
    )

    fallback = {
        "title": f"{name}提请审议始源区秩序",
        "proposal": sanitize_council_text(
            "据近期旅者言行与诸界情势，本席提请议会共商始源区协作之道，请诸位同僚评议。"
            if _has_traveler_material(ctx)
            else "本席提请议会共商始源区协作之道，请诸位同僚评议表决。"
        ),
    }
    data = _invoke_vote_json(
        settings,
        prompt,
        fallback=fallback,
        recover_kind="proposal",
        recover_seed=ctx.job_id,
    )
    title = sanitize_council_text(str(data.get("title") or "议会提案").strip())[:120]
    proposal = sanitize_council_text(str(data.get("proposal") or title).strip())[:8000]
    if _has_traveler_material(ctx):
        if TRAVELER_KEYWORD not in title and "旅者言行" not in title:
            title = f"据近期{TRAVELER_KEYWORD}言行：{title}"[:120]
        if TRAVELER_KEYWORD not in proposal and "旅者言行" not in proposal:
            proposal = f"据近期{TRAVELER_KEYWORD}言行，{proposal}"[:8000]
    return {"title": title, "proposal": proposal}


def _append_proposer_reading(
    ctx: VoteContext,
    proposer_id: str,
    title: str,
    proposal: str,
) -> None:
    """Round-0 proposer reading in debate transcript (D-REL-V2-01)."""
    persona = get_persona(proposer_id)
    name = persona["displayName"] if persona else proposer_id
    text = sanitize_council_text(f"{title}。{proposal[:200]}")
    ctx.debate_transcript.append(
        {"npcId": proposer_id, "displayName": name, "text": text, "round": 0}
    )


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
    persona_block = build_vote_persona_block(npc_id, ctx.relationship_edges)
    rel_block = format_relationship_block_for_npc(npc_id, ctx.relationship_edges)
    prompt = (
        f"{COUNCIL_VOTE_SETTING}\n"
        f"议会辩论第{round_num}轮。提案标题：{title}\n"
        f"提案摘要：{proposal_excerpt[:200]}\n"
        f"发言人：{name}({npc_id})\n"
        f"{persona_block}\n"
        f"debateStyle：{persona['debateStyle'] if persona else ''}\n"
        f"运行时关系：\n{rel_block}\n"
        f"{debate_output_instructions()}"
        f'{_VOTE_JSON_SUFFIX}'
    )
    debate_fallback = (
        f"据近期{TRAVELER_KEYWORD}言行，本席暂无补充。"
        if _has_traveler_material(ctx)
        else "本席暂无补充。"
    )
    data = _invoke_vote_json(
        settings,
        prompt,
        fallback={
            "fullText": debate_fallback,
            "feedQuote": "本席暂无补充。",
            "stance": "neutral",
        },
        recover_kind="debate",
        recover_npc_id=npc_id,
        recover_seed=ctx.job_id,
    )
    raw_full = str(data.get("fullText") or data.get("text") or debate_fallback)
    full_text = clamp_full_debate(raw_full, fallback=debate_fallback)
    if _has_traveler_material(ctx) and TRAVELER_KEYWORD not in full_text and "旅者言行" not in full_text:
        full_text = clamp_full_debate(
            f"据近期{TRAVELER_KEYWORD}言行，{full_text}",
            fallback=debate_fallback,
        )
    feed_quote = clamp_feed_quote(
        str(data.get("feedQuote") or ""),
        fallback=clamp_feed_quote(full_text),
    )
    traveler_ref = _has_traveler_material(ctx) and (
        TRAVELER_KEYWORD in full_text or "旅者言行" in full_text
    )
    stance = str(data.get("stance") or "neutral").lower()
    if stance not in ("support", "oppose", "neutral"):
        stance = "neutral"
    return {
        "npcId": npc_id,
        "displayName": name,
        "text": full_text,
        "feedQuote": feed_quote,
        "round": round_num,
        "stance": stance,
        "travelerRef": traveler_ref,
    }


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

    non_proposer = [nid for nid in COUNCIL_NPC_IDS if nid != ctx.proposer_id]
    round_lines: list[dict[str, Any]] = []

    if settings.llm_mock or os.getenv("LLM_MOCK") == "1":
        for npc_id in non_proposer:
            line = _debate_utterance(ctx, npc_id, round_num, title, excerpt, settings)
            ctx.debate_transcript.append(line)
            round_lines.append(line)
        proposer_line = _debate_utterance(ctx, ctx.proposer_id, round_num, title, excerpt, settings)
        ctx.debate_transcript.append(proposer_line)
    else:
        with ThreadPoolExecutor(max_workers=4) as pool:
            futures = {
                pool.submit(
                    _debate_utterance, ctx, npc_id, round_num, title, excerpt, settings
                ): npc_id
                for npc_id in non_proposer
            }
            for future in as_completed(futures):
                round_lines.append(future.result())
        round_lines.sort(key=lambda line: COUNCIL_NPC_IDS.index(line["npcId"]))
        ctx.debate_transcript.extend(round_lines)
        proposer_line = _debate_utterance(ctx, ctx.proposer_id, round_num, title, excerpt, settings)
        ctx.debate_transcript.append(proposer_line)

    highlights: list[dict[str, Any]] = []
    for line in round_lines[:3]:
        quote_text = clamp_feed_quote(str(line.get("feedQuote") or line.get("text") or ""))
        row: dict[str, Any] = {
            "kind": "quote",
            "npcId": line["npcId"],
            "displayName": line["displayName"],
            "text": quote_text,
            "travelerRef": bool(line.get("travelerRef")),
        }
        highlights.append(row)
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
    proposer_id = ctx.proposer_id
    proposer_name = display_name(proposer_id)
    persona_block = build_vote_persona_block(npc_id, ctx.relationship_edges)
    rel_block = format_relationship_block_for_npc(npc_id, ctx.relationship_edges)
    proposer_rel = format_proposer_relationship(npc_id, proposer_id, ctx.relationship_edges)
    debate_summary = format_debate_transcript_summary(ctx.debate_transcript)
    prompt = (
        f"{COUNCIL_VOTE_SETTING}\n"
        f"{ballot_prompt_instructions(proposer_id=proposer_id, proposer_name=proposer_name)}\n"
        f"议会最终表决。提案：{title}\n摘要：{proposal_excerpt[:400]}\n"
        f"表决人：{name}({npc_id})\n"
        f"{persona_block}\n"
        f"投票倾向参考：{persona['votingLeaning'] if persona else 'swing'}\n"
        f"{proposer_rel}\n"
        f"运行时关系：\n{rel_block}\n"
        f"本轮辩论摘要：\n{debate_summary}\n"
        "输出 JSON：vote(yes|no), reasonZh(≤80字)。"
        f'{_VOTE_JSON_SUFFIX}'
    )
    default_vote = _leaning_default_vote(npc_id, ctx.job_id, room_id=ctx.room_id)
    default_reason = _persona_fallback_ballot_reason(npc_id, default_vote)
    data = _invoke_vote_json(
        settings,
        prompt,
        fallback={"vote": default_vote, "reasonZh": default_reason},
        recover_kind="ballot",
        recover_npc_id=npc_id,
        recover_seed=ctx.job_id,
        recover_room_id=ctx.room_id,
    )
    vote = str(data.get("vote") or default_vote).lower()
    if vote not in ("yes", "no"):
        vote = "yes" if "赞成" in vote or vote == "y" else "no"
    reason = non_empty_council_line(
        str(data.get("reasonZh") or default_reason),
        default_reason,
        max_len=120,
    )
    return reconcile_ballot_vote_reason(
        {"npcId": npc_id, "displayName": name, "vote": vote, "reasonZh": reason}
    )


def _persona_fallback_ballot_reason(npc_id: str, vote: str) -> str:
    """Deterministic persona-flavored fallback when vote JSON parse fails."""
    block = build_vote_persona_block(npc_id, None)
    name = display_name(npc_id)
    if "秩序" in block and vote == "no":
        return "此举恐动摇始源区既有秩序，本席不能苟同。"
    if "乐子" in block or "有趣" in block:
        return "不够有趣，反对。" if vote == "no" else "够戏剧化，本席赞成！"
    if "和平" in block or "生灵" in block:
        return "须先护弱小生灵，本席赞成。" if vote == "yes" else "恐伤及无辜，本席反对。"
    if "利益" in block or "交易" in block:
        return "收益可覆盖风险，赞成。" if vote == "yes" else "成本过高，不合算，反对。"
    if vote == "yes":
        return f"依本席所司，此议可落地，赞成。"
    return f"依本席判断，暂不宜通过。"


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


def build_debate_excerpts(
    proposer_id: str,
    debate_transcript: list[dict[str, Any]],
    *,
    max_excerpts: int = 18,
) -> list[dict[str, Any]]:
    """Minutes debate archive — non-proposer lines from round >= 1 (ISSUE-094)."""
    excerpts: list[dict[str, Any]] = []
    for row in debate_transcript:
        npc_id = str(row.get("npcId") or "")
        round_num = int(row.get("round") or 0)
        if round_num < 1 or npc_id == proposer_id or not npc_id:
            continue
        full_text = clamp_full_debate(str(row.get("text") or ""))
        feed_quote = clamp_feed_quote(str(row.get("feedQuote") or full_text))
        excerpts.append(
            {
                "round": round_num,
                "npcId": npc_id,
                "displayName": str(row.get("displayName") or display_name(npc_id)),
                "fullText": full_text,
                "feedQuote": feed_quote,
            }
        )
    excerpts.sort(
        key=lambda e: (
            int(e.get("round") or 0),
            COUNCIL_NPC_IDS.index(str(e.get("npcId") or "npc-1"))
            if str(e.get("npcId") or "") in COUNCIL_NPC_IDS
            else 99,
        )
    )
    return excerpts[:max_excerpts]


def build_minutes(
    proposer_id: str,
    proposal: str,
    ballots: list[dict[str, Any]],
    debate_transcript: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    voters = [b for b in ballots if b["npcId"] != proposer_id]
    voters.sort(key=lambda b: COUNCIL_NPC_IDS.index(b["npcId"]))
    if len(voters) != 11:
        raise ValueError(f"expected 11 non-proposer ballots, got {len(voters)}")
    minutes: dict[str, Any] = {
        "kind": "vote_minutes",
        "proposalFull": proposal,
        "ballots": voters,
    }
    if debate_transcript:
        excerpts = build_debate_excerpts(proposer_id, debate_transcript)
        if excerpts:
            minutes["debateExcerpts"] = excerpts
    return minutes


def post_deliberation_sync(
    client: httpx.Client,
    settings: Settings,
    ctx: VoteContext,
    payload: dict[str, Any],
) -> None:
    url = f"{settings.game_server_url.rstrip('/')}/internal/rooms/{ctx.room_id}/council-deliberation-sync"
    body = finalize_deliberation_sync_payload(payload)
    res = client.post(url, json=body, headers=_game_headers(settings), timeout=30.0)
    if res.status_code == 400 and isinstance(body.get("feedDelta"), list):
        retry_body = finalize_deliberation_sync_payload(
            {**payload, "feedDelta": body.get("feedDelta")}
        )
        if retry_body != body:
            res = client.post(url, json=retry_body, headers=_game_headers(settings), timeout=30.0)
            body = retry_body
    if res.status_code >= 400:
        print(
            f"council-deliberation-sync {res.status_code} room={ctx.room_id} "
            f"phase={body.get('phase')} body={res.text[:500]}",
            file=sys.stderr,
        )
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
        "yesCount": yes_count,
        "noCount": no_count,
        "voteEpoch": ctx.vote_epoch,
        "mapRoomId": ctx.room_id,
    }
    res = client.post(url, json=body, headers=_game_headers(settings), timeout=60.0)
    res.raise_for_status()
    return res.json()


def append_council_memories(
    client: httpx.Client,
    settings: Settings,
    ctx: VoteContext,
    ballots: list[dict[str, Any]],
) -> None:
    url = (
        f"{settings.game_server_url.rstrip('/')}/internal/rooms/{ctx.room_id}/council-vote-memories"
    )
    body = {
        "ballots": [
            {
                "npcId": ballot["npcId"],
                "vote": ballot["vote"],
                "reasonZh": ballot["reasonZh"],
            }
            for ballot in ballots
        ],
    }
    res = _post_with_retry(
        client,
        url,
        json_body=body,
        headers=_game_headers(settings),
        timeout=120.0,
        attempts=3,
    )
    data = res.json()
    expected = len(ballots)
    written = int(data.get("count") or 0)
    if written != expected:
        raise RuntimeError(f"council vote memories incomplete: {written}/{expected}")


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
        seed=stable_string_hash(ctx.job_id) % (2**31),
    )
    if not deltas:
        return []
    url = f"{settings.game_server_url.rstrip('/')}/internal/rooms/{ctx.room_id}/npc-relationships/apply-deltas"
    body = {"deltas": deltas, "voteEpoch": ctx.vote_epoch}
    _post_with_retry(
        client,
        url,
        json_body=body,
        headers=_game_headers(settings),
        timeout=90.0,
        attempts=3,
    )
    ui_edges = filter_linked_edges_for_ui(deltas)
    print(
        f"relationship-deltas applied={len(deltas)} ui_linked={len(ui_edges)} "
        f"jobId={ctx.job_id}",
        file=sys.stderr,
    )
    return ui_edges


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
    res = client.post(url, json=body, headers=_game_headers(settings), timeout=30.0)
    res.raise_for_status()


def post_deliberation_checkpoint(
    client: httpx.Client,
    settings: Settings,
    ctx: VoteContext,
    *,
    title: str,
    proposal: str,
    current_round: int,
    proposer_id: str,
) -> dict[str, Any]:
    """Persist paced deliberation slice; releases queue pending for next game-day job."""
    url = f"{settings.game_server_url.rstrip('/')}/internal/rooms/{ctx.room_id}/world-vote/checkpoint"
    body = {
        "jobId": ctx.vote_epoch_base_job_id,
        "completingJobId": ctx.job_id,
        "voteKind": ctx.vote_kind,
        "proposerIndex": ctx.proposer_index,
        "proposalTitle": title,
        "proposalBody": proposal,
        "currentRound": current_round,
        "debateRoundsMax": ctx.debate_rounds_max,
        "phase": "debate",
        "transcript": ctx.debate_transcript,
    }
    res = _post_with_retry(
        client,
        url,
        json_body=body,
        headers=_game_headers(settings),
        timeout=60.0,
        attempts=3,
    )
    return res.json()


def _sync_debate_round(
    client: httpx.Client,
    settings: Settings,
    ctx: VoteContext,
    *,
    round_num: int,
    title: str,
    proposal: str,
    cfg: Settings,
) -> list[dict[str, Any]]:
    highlights = run_one_debate_round(ctx, round_num, title, proposal, cfg)
    post_deliberation_sync(
        client,
        settings,
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
    return highlights


def _finalize_vote_job(
    client: httpx.Client,
    cfg: Settings,
    ctx: VoteContext,
    *,
    proposer_id: str,
    title: str,
    proposal: str,
) -> dict[str, Any]:
    ballots = cast_ballots(ctx, title, proposal, cfg)
    status, yes_count, no_count = tally_ballots(ballots, proposer_id)
    minutes = build_minutes(proposer_id, proposal, ballots, ctx.debate_transcript)

    if not is_job_still_pending(client, cfg, ctx):
        print(
            f"world-vote job superseded before writeback jobId={ctx.job_id} room={ctx.room_id}",
            file=sys.stderr,
        )
        return {"status": "superseded", "jobId": ctx.job_id}

    vote_feed = [
        {
            "kind": "vote",
            "npcId": b["npcId"],
            "displayName": b["displayName"],
            "vote": b["vote"],
            "reasonZh": non_empty_council_line(
                str(b.get("reasonZh") or ""),
                "依本席判断。",
                max_len=120,
            ),
        }
        for b in minutes["ballots"]
    ]
    post_deliberation_sync(
        client,
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
        client,
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

    post_vote_complete(client, cfg, ctx)
    linked_edges = apply_relationship_deltas(client, cfg, ctx, ctx.debate_transcript, ballots)
    append_council_memories(client, cfg, ctx, minutes["ballots"])
    writeback_sequence(
        client,
        cfg,
        ctx,
        title=title,
        proposal=proposal,
        status=status,
        yes_count=yes_count,
        no_count=no_count,
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


def _run_world_vote_instant(
    http: httpx.Client,
    cfg: Settings,
    ctx: VoteContext,
    proposer_id: str,
) -> dict[str, Any]:
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
    _append_proposer_reading(ctx, proposer_id, title, proposal)

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
        _sync_debate_round(http, cfg, ctx, round_num=round_num, title=title, proposal=proposal, cfg=cfg)

    return _finalize_vote_job(http, cfg, ctx, proposer_id=proposer_id, title=title, proposal=proposal)


def _run_world_vote_paced(
    http: httpx.Client,
    cfg: Settings,
    ctx: VoteContext,
    proposer_id: str,
) -> dict[str, Any]:
    checkpoint = ctx.deliberation_checkpoint

    if checkpoint:
        title = str(checkpoint.get("proposalTitle") or "")
        proposal = str(checkpoint.get("proposalBody") or "")
        round_num = int(checkpoint.get("currentRound") or 0) + 1
        if not title or not proposal or round_num < 1:
            raise RuntimeError("invalid deliberation checkpoint for paced resume")
    else:
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
        _append_proposer_reading(ctx, proposer_id, title, proposal)
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
        round_num = 1

    _sync_debate_round(http, cfg, ctx, round_num=round_num, title=title, proposal=proposal, cfg=cfg)

    if round_num < ctx.debate_rounds_max:
        ck_res = post_deliberation_checkpoint(
            http,
            cfg,
            ctx,
            title=title,
            proposal=proposal,
            current_round=round_num,
            proposer_id=proposer_id,
        )
        return {
            "status": "paused",
            "jobId": ctx.job_id,
            "currentRound": round_num,
            "nextRoundAtGameMinute": ck_res.get("nextRoundAtGameMinute"),
            "title": title,
            "proposerId": proposer_id,
        }

    return _finalize_vote_job(http, cfg, ctx, proposer_id=proposer_id, title=title, proposal=proposal)


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
    linked_edges: list[dict[str, str]],
    result_entry_id: str | None = None,
) -> None:
    post_deliberation_sync(
        client,
        settings,
        ctx,
        {
            "active": False,
            "voteKind": ctx.vote_kind,
            "phase": "sealed",
            "round": ctx.debate_rounds_max,
            "roundTotal": ctx.debate_rounds_max,
            "proposalTitle": title,
            "linkedEdges": normalize_linked_edges(linked_edges),
            **({"resultEntryId": result_entry_id} if result_entry_id else {}),
            "yesCount": yes_count,
            "noCount": no_count,
            "status": status,
            "clearFeed": True,
        },
    )


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

        if ctx.instant_debate:
            return _run_world_vote_instant(http, cfg, ctx, proposer_id)
        return _run_world_vote_paced(http, cfg, ctx, proposer_id)
    finally:
        if owns_client:
            http.close()


def _minimal_ctx_from_payload(payload: dict[str, Any]) -> VoteContext:
    resume_raw = payload.get("resumeJobId")
    return VoteContext(
        room_id=str(payload.get("roomId") or "default"),
        vote_kind=str(payload.get("voteKind") or "regular"),
        game_minute=int(payload.get("gameMinute") or 0),
        proposer_index=int(payload.get("proposerIndex") or 0),
        debate_rounds_max=max(1, min(DEBATE_ROUNDS_MAX, int(payload.get("debateRoundsMax") or 2))),
        job_id=str(payload.get("jobId") or "unknown"),
        instant_debate=payload.get("instant") is not False,
        resume_job_id=str(resume_raw) if resume_raw else None,
    )


def post_deliberation_failed(
    client: httpx.Client,
    settings: Settings,
    payload: dict[str, Any],
) -> None:
    """Clear in-flight deliberation UI when a world-vote job aborts."""
    ctx = _minimal_ctx_from_payload(payload)
    try:
        if not is_job_still_pending(client, settings, ctx):
            print(
                f"world-vote failure cleanup skipped for superseded jobId={ctx.job_id}",
                file=sys.stderr,
            )
            return
        post_deliberation_sync(
            client,
            settings,
            ctx,
            {
                "active": False,
                "voteKind": ctx.vote_kind,
                "phase": "sealed",
                "round": 0,
                "roundTotal": ctx.debate_rounds_max,
                "clearFeed": True,
            },
        )
        post_vote_complete(client, settings, ctx)
    except Exception as exc:
        print(f"world-vote failure cleanup error: {exc}", file=sys.stderr)


def process_world_vote_job(
    client: httpx.Client,
    settings: Settings,
    payload: dict[str, Any],
) -> None:
    job_id = payload.get("jobId", "unknown")
    print(f"world-vote job received jobId={job_id} room={payload.get('roomId')}", file=sys.stderr)
    try:
        run_world_vote_job(payload, settings=settings, client=client)
    except Exception as exc:
        print(f"world-vote job failed jobId={job_id}: {exc}", file=sys.stderr)
        post_deliberation_failed(client, settings, payload)
        raise
