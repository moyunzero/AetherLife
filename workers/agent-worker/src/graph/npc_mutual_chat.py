"""NPC mutual-chat worker job (D-MUTUAL-02/04/06/07).

Short LLM dialogue → apply-deltas → REL-07 at |Δ|≥4 → linkedEdges hint at |Δ|≥8
→ dual activity + one-shot bubble presentation. Yields to speak like world-vote.
"""

from __future__ import annotations

import os
import re
import sys
from typing import Any, TypedDict

import httpx

from src.config import Settings, get_settings
from src.council.constants import COUNCIL_MEMORY_PLAYER_ID, HISTORY_SUMMARY_DELTA_THRESHOLD
from src.council.registry import display_name
from src.council.relationship_deltas import RelationshipDelta, filter_linked_edges_for_ui
from src.graph.lore_loop import _extract_json_object, _invoke_lore_llm
from src.graph.personal_timeline import (
    DYAD_REL_MIN_ABS_DELTA,
    apply_single_relationship_delta,
    enqueue_rel07_bilateral_jobs,
    personal_timeline_llm_attempts,
)
from src.memory.client import append_player_memory
from src.memory.importance import DEFAULT_IMPORTANCE

NPC_MUTUAL_CHAT_JOBS_KEY = "aetherlife:npc-mutual-chat:jobs"
MUTUAL_CHAT_BUBBLE_MAX_CHARS = 20
MUTUAL_LINKED_HINT_MIN_ABS = HISTORY_SUMMARY_DELTA_THRESHOLD  # 8
MUTUAL_REL07_MIN_ABS = DYAD_REL_MIN_ABS_DELTA  # 4

_CONTROL_CHARS = re.compile(r"[\x00-\x1f\x7f]")


class MutualDialogue(TypedDict, total=False):
    lines: list[str]
    bubbleText: str
    affectionDelta: int
    summaryZh: str
    historyAppend: str


def _game_headers(settings: Settings) -> dict[str, str]:
    headers: dict[str, str] = {"Content-Type": "application/json"}
    if settings.internal_worker_token:
        headers["Authorization"] = f"Bearer {settings.internal_worker_token}"
    return headers


def clamp_bubble_text(text: str, *, max_chars: int = MUTUAL_CHAT_BUBBLE_MAX_CHARS) -> str:
    cleaned = _CONTROL_CHARS.sub("", (text or "").strip())
    if len(cleaned) <= max_chars:
        return cleaned
    return cleaned[:max_chars]


def activity_reason_zh(peer_npc_id: str) -> str:
    name = display_name(peer_npc_id) if peer_npc_id else peer_npc_id
    return f"与{name}交谈中"


def _mock_dialogue(*, npc_a_id: str, npc_b_id: str) -> MutualDialogue:
    a = display_name(npc_a_id)
    b = display_name(npc_b_id)
    return {
        "lines": [f"{a}：今日庭中风软。", f"{b}：正好叙话片刻。"],
        "bubbleText": "今日庭中风软",
        "affectionDelta": 5,
        "summaryZh": f"{a}与{b}闲谈片刻",
        "historyAppend": f"{a}与{b}闲谈亲近（Δ+5）",
    }


def generate_mutual_dialogue(
    settings: Settings,
    *,
    npc_a_id: str,
    npc_b_id: str,
) -> MutualDialogue:
    """Non-speak JSON path — never 智谱 (reuse personal-timeline provider chain)."""
    if settings.llm_mock or os.getenv("LLM_MOCK") == "1":
        return _mock_dialogue(npc_a_id=npc_a_id, npc_b_id=npc_b_id)

    a_name = display_name(npc_a_id)
    b_name = display_name(npc_b_id)
    prompt = (
        "你是生活模拟游戏的短对话写手。两名议会 NPC 在近旁偶遇闲谈。\n"
        f"NPC_A={a_name}({npc_a_id}) NPC_B={b_name}({npc_b_id})。\n"
        "只输出一个 JSON 对象，不要 markdown。字段：\n"
        "lines(字符串数组，2–4 句短对白)；"
        "bubbleText(≤20字，玩家可见气泡摘要)；"
        "affectionDelta(整数，建议 -6..+8，偶遇闲谈常见 +1..+6)；"
        "summaryZh(≤40字，议会记忆短记)；"
        "historyAppend(≤80字，写入关系史)。\n"
        "禁止暴力；禁止提及玩家；禁止 tool_calls。"
    )

    last_exc: BaseException | None = None
    for provider, model in personal_timeline_llm_attempts(settings):
        try:
            raw = _invoke_lore_llm(settings, provider, model, prompt)
            data = _extract_json_object(raw)
            lines_raw = data.get("lines") or []
            lines = [str(x).strip() for x in lines_raw if str(x).strip()][:4]
            delta = int(data.get("affectionDelta") or 0)
            delta = max(-15, min(15, delta))
            bubble = clamp_bubble_text(str(data.get("bubbleText") or (lines[0] if lines else "")))
            return {
                "lines": lines or _mock_dialogue(npc_a_id=npc_a_id, npc_b_id=npc_b_id)["lines"],
                "bubbleText": bubble,
                "affectionDelta": delta,
                "summaryZh": str(data.get("summaryZh") or "").strip()[:80],
                "historyAppend": str(data.get("historyAppend") or "").strip()[:120],
            }
        except Exception as exc:
            last_exc = exc
            print(
                f"mutual-chat LLM provider={provider} failed: {exc}",
                file=sys.stderr,
            )
            continue
    print(f"mutual-chat LLM failed, using mock fallback: {last_exc}", file=sys.stderr)
    return _mock_dialogue(npc_a_id=npc_a_id, npc_b_id=npc_b_id)


def post_mutual_chat_presentation(
    client: httpx.Client,
    settings: Settings,
    *,
    room_id: str,
    npc_a_id: str,
    npc_b_id: str,
    bubble_text: str,
) -> None:
    url = (
        f"{settings.game_server_url.rstrip('/')}/internal/rooms/{room_id}"
        "/npc-mutual-chat/present"
    )
    body = {
        "npcAId": npc_a_id,
        "npcBId": npc_b_id,
        "npcAReasonZh": activity_reason_zh(npc_b_id),
        "npcBReasonZh": activity_reason_zh(npc_a_id),
        "bubbleText": clamp_bubble_text(bubble_text),
    }
    res = client.post(url, json=body, headers=_game_headers(settings), timeout=20.0)
    res.raise_for_status()


def post_linked_edges_hint(
    client: httpx.Client,
    settings: Settings,
    *,
    room_id: str,
    linked_edges: list[dict[str, str]],
) -> None:
    if not linked_edges:
        return
    url = (
        f"{settings.game_server_url.rstrip('/')}/internal/rooms/{room_id}"
        "/npc-mutual-chat/linked-edges-hint"
    )
    res = client.post(
        url,
        json={"linkedEdges": linked_edges},
        headers=_game_headers(settings),
        timeout=20.0,
    )
    res.raise_for_status()


def maybe_append_council_summary(
    client: httpx.Client,
    settings: Settings,
    *,
    room_id: str,
    npc_a_id: str,
    summary_zh: str,
) -> None:
    text = (summary_zh or "").strip()
    if not text:
        return
    append_player_memory(
        client,
        settings,
        room_id,
        text[:200],
        npc_id=npc_a_id,
        player_id=COUNCIL_MEMORY_PLAYER_ID,
        importance=DEFAULT_IMPORTANCE,
    )


def process_npc_mutual_chat_job(
    client: httpx.Client,
    settings: Settings | None,
    payload: dict[str, Any],
) -> None:
    cfg = settings or get_settings()
    room_id = str(payload.get("roomId") or "").strip()
    npc_a_id = str(payload.get("npcAId") or "").strip()
    npc_b_id = str(payload.get("npcBId") or "").strip()
    job_id = str(payload.get("jobId") or "")
    epoch = int(payload.get("absoluteGameMinute") or 0)
    if not room_id or not npc_a_id or not npc_b_id or npc_a_id == npc_b_id:
        print(f"mutual-chat invalid payload jobId={job_id}; ignoring", file=sys.stderr)
        return

    dialogue = generate_mutual_dialogue(cfg, npc_a_id=npc_a_id, npc_b_id=npc_b_id)
    affection = int(dialogue.get("affectionDelta") or 0)
    history = str(dialogue.get("historyAppend") or "").strip()
    bubble = clamp_bubble_text(str(dialogue.get("bubbleText") or ""))

    apply_single_relationship_delta(
        client,
        cfg,
        room_id=room_id,
        npc_a_id=npc_a_id,
        npc_b_id=npc_b_id,
        affection_delta=affection,
        history_append=history,
    )

    event_anchor_id = f"mc-{job_id or f'{room_id}-{npc_a_id}-{npc_b_id}-{epoch}'}"
    rel_jobs = enqueue_rel07_bilateral_jobs(
        room_id=room_id,
        npc_a_id=npc_a_id,
        npc_b_id=npc_b_id,
        event_anchor_id=event_anchor_id,
        affection_delta=affection,
        aether_epoch_minute=epoch,
        history_append=history,
        min_abs_delta=MUTUAL_REL07_MIN_ABS,
        settings=cfg,
    )

    if abs(affection) >= MUTUAL_LINKED_HINT_MIN_ABS:
        delta: RelationshipDelta = {
            "npcAId": npc_a_id,
            "npcBId": npc_b_id,
            "affectionDelta": affection,
        }
        linked = filter_linked_edges_for_ui([delta], min_abs=MUTUAL_LINKED_HINT_MIN_ABS)
        if linked:
            post_linked_edges_hint(client, cfg, room_id=room_id, linked_edges=linked)

    post_mutual_chat_presentation(
        client,
        cfg,
        room_id=room_id,
        npc_a_id=npc_a_id,
        npc_b_id=npc_b_id,
        bubble_text=bubble,
    )

    maybe_append_council_summary(
        client,
        cfg,
        room_id=room_id,
        npc_a_id=npc_a_id,
        summary_zh=str(dialogue.get("summaryZh") or ""),
    )

    print(
        f"mutual-chat ok jobId={job_id} pair={npc_a_id}/{npc_b_id} "
        f"Δ={affection:+d} rel_jobs={len(rel_jobs)} bubble={bubble!r}",
        file=sys.stderr,
    )
