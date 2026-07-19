"""Personal life timeline jobs — polish + weekly digest (BIO-03/05, D-GEN-*).

Uses reflect/lore providers only — never Zhipu speak slot (D-GEN-04).
Event / multi / rel kinds are stubs for plan 05.
"""

from __future__ import annotations

import os
import sys
from typing import Any

import httpx

from src.config import Settings, get_settings
from src.council.constants import COUNCIL_NPC_IDS
from src.council.registry import display_name
from src.graph.lore_loop import _invoke_lore_llm

FORBIDDEN_BIO_PROVIDERS = frozenset({"zhipu"})

WEEKLY_MIN_CHARS = 200
WEEKLY_MAX_CHARS = 400


def personal_timeline_llm_attempts(settings: Settings) -> list[tuple[str, str]]:
    """Reflect/lore providers only — never zhipu speak slot (D-GEN-04)."""
    attempts: list[tuple[str, str]] = []
    reflect_provider = (settings.llm_provider_reflect or "agnes").strip().lower()
    reflect_model = settings.llm_model_reflect or "agnes-2.0-flash"
    if reflect_provider not in FORBIDDEN_BIO_PROVIDERS:
        attempts.append((reflect_provider, reflect_model))

    lore_provider = (
        settings.llm_provider_lore or settings.llm_provider_reflect or "agnes"
    ).strip().lower()
    lore_model = (
        settings.llm_model_lore_t0 or settings.llm_model_reflect or reflect_model
    )
    if lore_provider not in FORBIDDEN_BIO_PROVIDERS:
        pair = (lore_provider, lore_model)
        if pair not in attempts:
            attempts.append(pair)

    nvidia_model = settings.llm_model_nvidia_fast or "meta/llama-3.3-70b-instruct"
    if ("nvidia", nvidia_model) not in attempts:
        attempts.append(("nvidia", nvidia_model))

    return [a for a in attempts if a[0] not in FORBIDDEN_BIO_PROVIDERS]


def _game_headers(settings: Settings) -> dict[str, str]:
    headers: dict[str, str] = {"Content-Type": "application/json"}
    if settings.internal_worker_token:
        headers["Authorization"] = f"Bearer {settings.internal_worker_token}"
    return headers


def _invoke_bio_llm(settings: Settings, prompt: str) -> str:
    if settings.llm_mock or os.getenv("LLM_MOCK") == "1":
        # Mock weekly body within D-GEN-05 budget (200–400 字).
        base = (
            "这一周我在始源庭中走动，听风过竹，也听同僚低声争论。"
            "白日里我把思绪收进袖中，夜里再摊开细想——人与天地都在缓慢改写。"
            "我仍以第一人称记下这些日子，既不夸大也不逃避。"
        )
        # Pad to >= 200 chars for contract smoke
        while len(base) < WEEKLY_MIN_CHARS:
            base += "我继续观察，继续等待合适的时机。"
        return base[:WEEKLY_MAX_CHARS]

    last_exc: BaseException | None = None
    for provider, model in personal_timeline_llm_attempts(settings):
        try:
            return _invoke_lore_llm(settings, provider, model, prompt)
        except Exception as exc:
            last_exc = exc
            print(f"personal-timeline LLM provider={provider} failed: {exc}", file=sys.stderr)
            continue
    assert last_exc is not None
    raise last_exc


def build_weekly_digest_prompt(
    *,
    npc_id: str,
    display_name: str,
    calendar_label: str,
    recent_bullets: list[str] | None = None,
) -> str:
    """BIO-03 / D-GEN-05: first-person weekly digest, 200–400 字; D-GEN-03 folds reflection."""
    bullets = recent_bullets or []
    bullet_block = "\n".join(f"- {b}" for b in bullets) if bullets else "- （本周暂无额外要点）"
    return (
        f"你是议会席位 {npc_id}（{display_name}）。"
        f"请用第一人称写一篇本周人生札记，对应历法标签：{calendar_label}。\n"
        f"字数预算：{WEEKLY_MIN_CHARS}–{WEEKLY_MAX_CHARS} 字（汉字为主）。\n"
        "把闲暇反思自然写进正文（不要单独另开「反思」段落）。\n"
        "只输出札记正文，不要标题、不要 markdown、不要第三人称旁白。\n"
        f"近期线索：\n{bullet_block}\n"
    )


def build_polish_prompt(
    *,
    npc_id: str,
    display_name: str,
    age: str,
    event: str,
    skeleton_body: str,
) -> str:
    return (
        f"你是议会席位 {npc_id}（{display_name}）。"
        f"请用第一人称润色下列人生节点骨架，保留事实，增强语感与个性。\n"
        f"年龄/阶段：{age}\n事件：{event}\n"
        f"骨架正文：\n{skeleton_body}\n"
        "只输出润色后的第一人称正文，不要标题或解释。"
    )


def _clamp_weekly_body(text: str) -> str:
    body = (text or "").strip()
    if len(body) > WEEKLY_MAX_CHARS + 40:
        body = body[:WEEKLY_MAX_CHARS]
    return body


def post_personal_timeline_entry(
    client: httpx.Client,
    settings: Settings,
    *,
    room_id: str,
    npc_id: str,
    calendar_label: str,
    aether_epoch_minute: int,
    tag: str,
    body: str,
    source: str,
    event_anchor_id: str | None = None,
    factual_summary: str | None = None,
) -> dict[str, Any]:
    url = f"{settings.game_server_url}/internal/rooms/{room_id}/personal-timeline"
    payload: dict[str, Any] = {
        "npcId": npc_id,
        "calendarLabel": calendar_label,
        "aetherEpochMinute": aether_epoch_minute,
        "tag": tag,
        "body": body,
        "source": source,
    }
    if event_anchor_id:
        payload["eventAnchorId"] = event_anchor_id
    if factual_summary:
        payload["factualSummary"] = factual_summary
    res = client.post(url, json=payload, headers=_game_headers(settings), timeout=60.0)
    res.raise_for_status()
    return res.json()


def patch_personal_timeline_body(
    client: httpx.Client,
    settings: Settings,
    *,
    room_id: str,
    entry_id: str,
    body: str,
) -> dict[str, Any]:
    """D-SEED-04: silently replace skeleton body when polish succeeds."""
    url = (
        f"{settings.game_server_url}/internal/rooms/{room_id}"
        f"/personal-timeline/{entry_id}"
    )
    res = client.patch(
        url,
        json={"body": body},
        headers=_game_headers(settings),
        timeout=60.0,
    )
    res.raise_for_status()
    return res.json()


def _calendar_label_from_epoch(epoch: int) -> str:
    """Minimal civil label — mirrors shared aetherCivilFromEpochMinute."""
    minutes_per_day = 1440
    days_per_year = 360
    days_per_month = 30
    seasons = ("春", "夏", "秋", "冬")
    e = max(0, int(epoch))
    day_index = e // minutes_per_day
    year = day_index // days_per_year
    day_in_year = day_index % days_per_year
    month = day_in_year // days_per_month + 1
    day_of_month = day_in_year % days_per_month + 1
    season = seasons[(month - 1) // 3]
    if year == 0:
        return f"太乙元年·{season}·{month}月·第{day_of_month}日"
    return f"太乙{year}年·{season}·{month}月·第{day_of_month}日"


def _run_polish(client: httpx.Client, settings: Settings, payload: dict) -> None:
    room_id = str(payload.get("roomId") or "")
    npc_id = str(payload.get("npcId") or "")
    entry_id = str(payload.get("entryId") or "")
    if not room_id or not npc_id or not entry_id:
        raise ValueError("polish job missing roomId/npcId/entryId")

    name = display_name(npc_id) if npc_id in COUNCIL_NPC_IDS else npc_id
    prompt = build_polish_prompt(
        npc_id=npc_id,
        display_name=name,
        age=str(payload.get("age") or ""),
        event=str(payload.get("event") or ""),
        skeleton_body=str(payload.get("skeletonBody") or ""),
    )
    polished = _invoke_bio_llm(settings, prompt).strip()
    if not polished:
        print(f"polish empty body jobId={payload.get('jobId')}", file=sys.stderr)
        return
    patch_personal_timeline_body(
        client,
        settings,
        room_id=room_id,
        entry_id=entry_id,
        body=polished,
    )


def _run_weekly(client: httpx.Client, settings: Settings, payload: dict) -> None:
    room_id = str(payload.get("roomId") or "")
    npc_id = str(payload.get("npcId") or "")
    epoch = int(payload.get("aetherEpochMinute") or 0)
    if not room_id or not npc_id:
        raise ValueError("weekly job missing roomId/npcId")

    name = display_name(npc_id) if npc_id in COUNCIL_NPC_IDS else npc_id
    label = _calendar_label_from_epoch(epoch)
    prompt = build_weekly_digest_prompt(
        npc_id=npc_id,
        display_name=name,
        calendar_label=label,
        recent_bullets=list(payload.get("recentBullets") or []),
    )
    body = _clamp_weekly_body(_invoke_bio_llm(settings, prompt))
    if not body:
        print(f"weekly empty body jobId={payload.get('jobId')}", file=sys.stderr)
        return
    post_personal_timeline_entry(
        client,
        settings,
        room_id=room_id,
        npc_id=npc_id,
        calendar_label=label,
        aether_epoch_minute=epoch,
        tag="daily",
        body=body,
        source="llm_scheduled",
    )


def _stub_kind(kind: str, payload: dict) -> None:
    """Plan 05: event / multi / rel — acknowledge only (D-GEN-02 hammer/REL deferred)."""
    print(
        f"personal-timeline stub kind={kind} jobId={payload.get('jobId')} "
        f"(deferred to plan 05)",
        file=sys.stderr,
    )


def process_personal_timeline_job(
    client: httpx.Client,
    settings: Settings | None,
    payload: dict,
) -> None:
    cfg = settings or get_settings()
    kind = str(payload.get("kind") or "").strip().lower()
    # Seed polish jobs omit kind — treat as polish when entryId present.
    if not kind and payload.get("entryId"):
        kind = "polish"
    if not kind:
        kind = "weekly"

    print(
        f"personal-timeline job kind={kind} jobId={payload.get('jobId')} "
        f"npc={payload.get('npcId')}",
        file=sys.stderr,
    )

    if kind == "polish":
        _run_polish(client, cfg, payload)
        return
    if kind == "weekly":
        _run_weekly(client, cfg, payload)
        return
    if kind in {"event", "multi", "multi_perspective", "rel", "rel07"}:
        _stub_kind(kind, payload)
        return
    print(f"personal-timeline unknown kind={kind}; ignoring", file=sys.stderr)
