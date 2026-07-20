"""Personal life timeline jobs — polish, weekly, multi-perspective, REL-07.

Uses reflect/lore providers only — never Zhipu speak slot (D-GEN-04).
BIO-06 / D-MULTI-*: multi after world_history write.
REL-07 / D-REL-01: bilateral relationship entries at |Δ|≥8.
"""

from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone
from typing import Any

import httpx

from src.config import Settings, get_settings
from src.council.constants import COUNCIL_NPC_IDS, HISTORY_SUMMARY_DELTA_THRESHOLD
from src.council.registry import display_name
from src.council.speak_registry import persona_block_for
from src.graph.lore_loop import _invoke_lore_llm

FORBIDDEN_BIO_PROVIDERS = frozenset({"zhipu"})

WEEKLY_MIN_CHARS = 200
WEEKLY_MAX_CHARS = 400
MULTI_MAX_CHARS = 80
REL_MIN_CHARS = 100
REL_MAX_CHARS = 200

# Anti-generic literary voice — all seats must keep dossier speakStyle (BIO persona fix).
_DIARY_ANTI_GENERIC = (
    "禁止所有席位共用的空泛文艺套话（听风过竹、袖中思绪、天地改写、玉兰留余地、"
    "独坐品茗等与人设无关的意象）；必须用该席位自己的口吻、价值观与惯用比喻。"
    "线索不足时写短、写实、写性格，勿硬编诗意。"
)

# D-MULTI-04: spread 12 seats across several SSOT game hours (30 min × 11 = 5.5h).
MULTI_STAGGER_GAME_MINUTES = 30

PERSONAL_TIMELINE_JOBS_KEY = "aetherlife:personal-timeline:jobs"
PERSONAL_TIMELINE_JOB_CLAIM_PREFIX = "aetherlife:personal-timeline:job-claimed:"
JOB_CLAIM_TTL_SECONDS = 60 * 60 * 24 * 14
# Dyad event path medium bar (speak/ambient) — below vote REL-07 threshold of 8.
DYAD_REL_MIN_ABS_DELTA = 4

_local_job_claims: set[str] = set()


def clear_personal_timeline_job_claims_for_test() -> None:
    """Test helper — reset process-local claim mirror."""
    _local_job_claims.clear()


def claim_personal_timeline_job_id(
    job_id: str,
    *,
    redis_client: Any | None = None,
    settings: Settings | None = None,
) -> bool:
    """SET NX claim before LPUSH — mirrors game-server claimPersonalTimelineJobId.

    Redis is used only when ``redis_client`` is passed, or ``settings.redis_url`` is set.
    Do not fall back to ``get_settings()`` — unit tests pass neither and must stay
    process-local (root ``.env`` durable claims otherwise poison fixed jobIds).
    """
    if not job_id:
        return False
    if job_id in _local_job_claims:
        return False

    client = redis_client
    close_client = False
    if client is None and settings is not None and settings.redis_url:
        import redis

        client = redis.from_url(settings.redis_url, decode_responses=True)
        close_client = True

    if client is not None:
        try:
            key = f"{PERSONAL_TIMELINE_JOB_CLAIM_PREFIX}{job_id}"
            ok = client.set(key, "1", nx=True, ex=JOB_CLAIM_TTL_SECONDS)
            if not ok:
                return False
            _local_job_claims.add(job_id)
            return True
        finally:
            if close_client:
                client.close()

    _local_job_claims.add(job_id)
    return True


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


def _mock_bio_body(*, kind: str, npc_id: str) -> str:
    if kind in {"multi", "multi_perspective"}:
        # Deterministic per-npc divergence under LLM_MOCK (BIO-06).
        return f"席位{npc_id}：庭议已定，我心潮难平，却绝不改写既定事实。"[:MULTI_MAX_CHARS]
    if kind in {"rel", "rel07"}:
        base = (
            f"席位{npc_id}：与同僚之间的情谊因廷议而起波澜。"
            "我把这份亲近或疏远写进心里，既不夸张也不回避。"
            "日后若再同席，我会记得此刻的温度。"
        )
        while len(base) < REL_MIN_CHARS:
            base += "我继续体察这份关系的细微变化。"
        return base[:REL_MAX_CHARS]
    if kind == "polish":
        base = (
            f"席位{npc_id}：那年的事我仍记得清楚。"
            "风声、誓言与抉择叠在一起，成了我后来所有站位的底色。"
            "我不愿用套话收束——只把这一幕按自己的语气写进心里。"
        )
        return base
    base = (
        "这一周我在始源庭中走动，听风过竹，也听同僚低声争论。"
        "白日里我把思绪收进袖中，夜里再摊开细想——人与天地都在缓慢改写。"
        "我仍以第一人称记下这些日子，既不夸大也不逃避。"
    )
    while len(base) < WEEKLY_MIN_CHARS:
        base += "我继续观察，继续等待合适的时机。"
    return base[:WEEKLY_MAX_CHARS]


def _invoke_bio_llm(
    settings: Settings,
    prompt: str,
    *,
    kind: str = "weekly",
    npc_id: str = "",
) -> str:
    if settings.llm_mock or os.getenv("LLM_MOCK") == "1":
        return _mock_bio_body(kind=kind, npc_id=npc_id)

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
    persona = persona_block_for(npc_id)
    return (
        f"你是议会席位 {npc_id}（{display_name}）。严格按下列人设写日记，不得串味：\n"
        f"{persona}\n\n"
        f"历法标签：{calendar_label}。\n"
        f"请用第一人称写一篇本周日记（人生札记），字数预算：{WEEKLY_MIN_CHARS}–{WEEKLY_MAX_CHARS} 字。\n"
        "日记骨架（自然融入正文，勿列小标题）：今日见闻 → 对某人/某事的态度 → 一句符合人设的收束。\n"
        "把闲暇反思自然写进正文（不要单独另开「反思」段落）。\n"
        f"{_DIARY_ANTI_GENERIC}\n"
        "只输出日记正文，不要标题、不要 markdown、不要第三人称旁白。\n"
        f"近期线索（可选用，勿捏造未出现的事实）：\n{bullet_block}\n"
    )


def build_polish_prompt(
    *,
    npc_id: str,
    display_name: str,
    age: str,
    event: str,
    skeleton_body: str,
) -> str:
    persona = persona_block_for(npc_id)
    return (
        f"你是议会席位 {npc_id}（{display_name}）。严格按下列人设润色，不得串味：\n"
        f"{persona}\n\n"
        f"请用第一人称润色下列人生节点骨架，保留事实，增强语感与个性。\n"
        f"年龄/阶段：{age}\n事件：{event}\n"
        f"骨架正文：\n{skeleton_body}\n"
        f"{_DIARY_ANTI_GENERIC}\n"
        "禁止使用「将此铭记于心，以为立身之基」或任何所有角色共用的固定收尾句。\n"
        "只输出润色后的第一人称正文，不要标题或解释。"
    )


def build_multi_perspective_prompt(
    *,
    npc_id: str,
    display_name: str,
    factual_summary: str,
    calendar_label: str,
) -> str:
    """BIO-06 / D-MULTI-03 / D-GEN-05: emotion/opinion only ≤80 字; facts locked."""
    persona = persona_block_for(npc_id)
    return (
        f"你是议会席位 {npc_id}（{display_name}）。严格按下列人设写观感，不得串味：\n"
        f"{persona}\n\n"
        f"历法：{calendar_label}。\n"
        f"事实摘要锁定（不得改写、不得补充事实）：{factual_summary}\n"
        f"请用第一人称只写情绪与看法/观感，字数预算：不超过 {MULTI_MAX_CHARS} 字。\n"
        "禁止改写事实摘要中的任何事实；不要复述提案全文。\n"
        f"{_DIARY_ANTI_GENERIC}\n"
        "只输出正文，不要标题或 markdown。\n"
    )


def build_rel07_prompt(
    *,
    npc_id: str,
    display_name: str,
    counterpart_id: str,
    counterpart_name: str,
    affection_delta: int,
    history_append: str = "",
) -> str:
    """REL-07 / D-GEN-05: relationship-tagged first-person, 100–200 字."""
    direction = "亲近" if affection_delta > 0 else "疏远" if affection_delta < 0 else "波动"
    note = history_append or f"廷议后{direction}（Δ{affection_delta:+d}）"
    persona = persona_block_for(npc_id)
    return (
        f"你是议会席位 {npc_id}（{display_name}）。严格按下列人设写关系日记，不得串味：\n"
        f"{persona}\n\n"
        f"请用第一人称写一段关于与 {counterpart_name}（{counterpart_id}）关系变化的日记。\n"
        f"关系线索：{note}\n"
        f"字数预算：{REL_MIN_CHARS}–{REL_MAX_CHARS} 字（汉字为主）。\n"
        "聚焦主观感受与关系温度，不要改写世界编年史事实。\n"
        f"{_DIARY_ANTI_GENERIC}\n"
        "只输出正文，不要标题或 markdown。\n"
    )


def _clamp_body(text: str, max_chars: int) -> str:
    body = (text or "").strip()
    if len(body) > max_chars + 20:
        body = body[:max_chars]
    return body


def _clamp_weekly_body(text: str) -> str:
    return _clamp_body(text, WEEKLY_MAX_CHARS)


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


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _lpush_jobs(
    jobs: list[dict[str, Any]],
    *,
    redis_client: Any | None = None,
    settings: Settings | None = None,
) -> None:
    if not jobs:
        return
    if redis_client is not None:
        for job in jobs:
            redis_client.lpush(PERSONAL_TIMELINE_JOBS_KEY, json.dumps(job, ensure_ascii=False))
        return
    # Explicit settings only — mirror claim_personal_timeline_job_id (no get_settings/.env).
    if settings is None or not settings.redis_url:
        return
    import redis

    client = redis.from_url(settings.redis_url, decode_responses=False)
    try:
        for job in jobs:
            client.lpush(PERSONAL_TIMELINE_JOBS_KEY, json.dumps(job, ensure_ascii=False))
    finally:
        client.close()


def enqueue_multi_perspective_jobs(
    *,
    room_id: str,
    event_anchor_id: str,
    factual_summary: str,
    aether_epoch_minute: int,
    redis_client: Any | None = None,
    settings: Settings | None = None,
) -> list[dict[str, Any]]:
    """BIO-06 / D-MULTI-01…04: 12 seats, shared anchor, staggered game-hour offsets."""
    jobs: list[dict[str, Any]] = []
    enqueued_at = _now_iso()
    for index, npc_id in enumerate(COUNCIL_NPC_IDS):
        offset = index * MULTI_STAGGER_GAME_MINUTES
        job_id = f"pt-multi-{room_id}-{event_anchor_id}-{npc_id}"
        if not claim_personal_timeline_job_id(
            job_id, redis_client=redis_client, settings=settings
        ):
            continue
        job: dict[str, Any] = {
            "kind": "multi",
            "roomId": room_id,
            "npcId": npc_id,
            "eventAnchorId": event_anchor_id,
            "factualSummary": factual_summary,
            "aetherEpochMinute": aether_epoch_minute + offset,
            "staggerOffsetGameMinutes": offset,
            "hammerEpochMinute": aether_epoch_minute,
            "tag": "council",
            "jobId": job_id,
            "enqueuedAt": enqueued_at,
        }
        jobs.append(job)
    _lpush_jobs(jobs, redis_client=redis_client, settings=settings)
    return jobs


def rel07_should_enqueue(
    *,
    affection_delta: int,
    status_tags_changed: bool = False,
    min_abs_delta: int | None = None,
) -> bool:
    """REL-07: |Δ|≥threshold or status_tags changed.

    Default threshold is HISTORY_SUMMARY_DELTA_THRESHOLD (8).
    Dyad event path passes ``min_abs_delta=DYAD_REL_MIN_ABS_DELTA`` (4).
    """
    if status_tags_changed:
        return True
    threshold = (
        HISTORY_SUMMARY_DELTA_THRESHOLD if min_abs_delta is None else int(min_abs_delta)
    )
    return abs(int(affection_delta)) >= threshold


def enqueue_rel07_bilateral_jobs(
    *,
    room_id: str,
    npc_a_id: str,
    npc_b_id: str,
    event_anchor_id: str,
    affection_delta: int,
    aether_epoch_minute: int,
    history_append: str = "",
    status_tags_changed: bool = False,
    force: bool = False,
    min_abs_delta: int | None = None,
    redis_client: Any | None = None,
    settings: Settings | None = None,
) -> list[dict[str, Any]]:
    """D-REL-01: both edge endpoints, same eventAnchorId, relationship tag.

    ``force=True`` skips threshold (legacy tests). Prefer ``min_abs_delta`` for dyads.
    """
    if not force and not rel07_should_enqueue(
        affection_delta=affection_delta,
        status_tags_changed=status_tags_changed,
        min_abs_delta=min_abs_delta,
    ):
        return []

    enqueued_at = _now_iso()
    jobs: list[dict[str, Any]] = []
    for npc_id, counterpart in ((npc_a_id, npc_b_id), (npc_b_id, npc_a_id)):
        job_id = f"pt-rel-{room_id}-{event_anchor_id}-{npc_id}"
        if not claim_personal_timeline_job_id(
            job_id, redis_client=redis_client, settings=settings
        ):
            continue
        job: dict[str, Any] = {
            "kind": "rel",
            "roomId": room_id,
            "npcId": npc_id,
            "counterpartNpcId": counterpart,
            "eventAnchorId": event_anchor_id,
            "affectionDelta": affection_delta,
            "historyAppend": history_append,
            "aetherEpochMinute": aether_epoch_minute,
            "tag": "relationship",
            "jobId": job_id,
            "enqueuedAt": enqueued_at,
        }
        jobs.append(job)
    _lpush_jobs(jobs, redis_client=redis_client, settings=settings)
    return jobs


def apply_single_relationship_delta(
    client: httpx.Client,
    settings: Settings,
    *,
    room_id: str,
    npc_a_id: str,
    npc_b_id: str,
    affection_delta: int,
    history_append: str = "",
) -> None:
    """POST undirected edge Δ (game-server normalizes pair order)."""
    url = (
        f"{settings.game_server_url.rstrip('/')}/internal/rooms/{room_id}"
        "/npc-relationships/apply-deltas"
    )
    delta: dict[str, Any] = {
        "npcAId": npc_a_id,
        "npcBId": npc_b_id,
        "affectionDelta": int(affection_delta),
    }
    if history_append.strip():
        delta["historyAppend"] = history_append.strip()
    res = client.post(
        url,
        json={"deltas": [delta]},
        headers=_game_headers(settings),
        timeout=60.0,
    )
    res.raise_for_status()


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
    polished = _invoke_bio_llm(settings, prompt, kind="polish", npc_id=npc_id).strip()
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
    print(
        f"polish ok jobId={payload.get('jobId')} npc={npc_id} chars={len(polished)}",
        file=sys.stderr,
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
    body = _clamp_weekly_body(_invoke_bio_llm(settings, prompt, kind="weekly", npc_id=npc_id))
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


def _run_multi(client: httpx.Client, settings: Settings, payload: dict) -> None:
    room_id = str(payload.get("roomId") or "")
    npc_id = str(payload.get("npcId") or "")
    event_anchor_id = str(payload.get("eventAnchorId") or "")
    factual = str(payload.get("factualSummary") or "").strip()
    # Shared event stamp = hammer epoch; stagger offset is enqueue delay only (WR-01).
    epoch = int(
        payload.get("hammerEpochMinute")
        if payload.get("hammerEpochMinute") is not None
        else (payload.get("aetherEpochMinute") or 0)
    )
    if not room_id or not npc_id or not event_anchor_id or not factual:
        raise ValueError("multi job missing roomId/npcId/eventAnchorId/factualSummary")

    name = display_name(npc_id) if npc_id in COUNCIL_NPC_IDS else npc_id
    label = _calendar_label_from_epoch(epoch)
    prompt = build_multi_perspective_prompt(
        npc_id=npc_id,
        display_name=name,
        factual_summary=factual,
        calendar_label=label,
    )
    body = _clamp_body(
        _invoke_bio_llm(settings, prompt, kind="multi", npc_id=npc_id),
        MULTI_MAX_CHARS,
    )
    if not body:
        print(f"multi empty body jobId={payload.get('jobId')}", file=sys.stderr)
        return
    post_personal_timeline_entry(
        client,
        settings,
        room_id=room_id,
        npc_id=npc_id,
        calendar_label=label,
        aether_epoch_minute=epoch,
        tag="council",
        body=body,
        source="llm_event",
        event_anchor_id=event_anchor_id,
        factual_summary=factual,
    )


def _run_rel(client: httpx.Client, settings: Settings, payload: dict) -> None:
    room_id = str(payload.get("roomId") or "")
    npc_id = str(payload.get("npcId") or "")
    counterpart = str(payload.get("counterpartNpcId") or "")
    event_anchor_id = str(payload.get("eventAnchorId") or "")
    epoch = int(payload.get("aetherEpochMinute") or 0)
    affection = int(payload.get("affectionDelta") or 0)
    history_append = str(payload.get("historyAppend") or "")
    if not room_id or not npc_id or not counterpart or not event_anchor_id:
        raise ValueError("rel job missing roomId/npcId/counterpartNpcId/eventAnchorId")

    name = display_name(npc_id) if npc_id in COUNCIL_NPC_IDS else npc_id
    counterpart_name = (
        display_name(counterpart) if counterpart in COUNCIL_NPC_IDS else counterpart
    )
    label = _calendar_label_from_epoch(epoch)
    prompt = build_rel07_prompt(
        npc_id=npc_id,
        display_name=name,
        counterpart_id=counterpart,
        counterpart_name=counterpart_name,
        affection_delta=affection,
        history_append=history_append,
    )
    body = _clamp_body(
        _invoke_bio_llm(settings, prompt, kind="rel", npc_id=npc_id),
        REL_MAX_CHARS,
    )
    if not body:
        print(f"rel empty body jobId={payload.get('jobId')}", file=sys.stderr)
        return
    post_personal_timeline_entry(
        client,
        settings,
        room_id=room_id,
        npc_id=npc_id,
        calendar_label=label,
        aether_epoch_minute=epoch,
        tag="relationship",
        body=body,
        source="llm_event",
        event_anchor_id=event_anchor_id,
    )


def _run_event(client: httpx.Client, settings: Settings, payload: dict) -> None:
    """Non-vote dyad: apply undirected Δ, then force bilateral relationship diaries."""
    room_id = str(payload.get("roomId") or "")
    npc_id = str(payload.get("npcId") or "")
    counterpart = str(payload.get("counterpartNpcId") or "")
    event_anchor_id = str(payload.get("eventAnchorId") or "")
    epoch = int(payload.get("aetherEpochMinute") or 0)
    affection = int(payload.get("affectionDelta") or 0)
    history_append = str(payload.get("historyAppend") or "")
    factual = str(payload.get("factualSummary") or "").strip()
    if not room_id or not npc_id or not counterpart or not event_anchor_id:
        raise ValueError("event job missing roomId/npcId/counterpartNpcId/eventAnchorId")

    if not history_append and factual:
        history_append = factual[:120]

    apply_single_relationship_delta(
        client,
        settings,
        room_id=room_id,
        npc_a_id=npc_id,
        npc_b_id=counterpart,
        affection_delta=affection,
        history_append=history_append,
    )
    jobs = enqueue_rel07_bilateral_jobs(
        room_id=room_id,
        npc_a_id=npc_id,
        npc_b_id=counterpart,
        event_anchor_id=event_anchor_id,
        affection_delta=affection,
        aether_epoch_minute=epoch,
        history_append=history_append or factual[:120],
        min_abs_delta=DYAD_REL_MIN_ABS_DELTA,
        settings=settings,
    )
    print(
        f"event ok jobId={payload.get('jobId')} pair={npc_id}/{counterpart} "
        f"Δ={affection:+d} rel_jobs={len(jobs)}",
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
        print(
            f"personal-timeline missing kind jobId={payload.get('jobId')}; ignoring",
            file=sys.stderr,
        )
        return

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
    if kind in {"multi", "multi_perspective"}:
        _run_multi(client, cfg, payload)
        return
    if kind in {"rel", "rel07"}:
        _run_rel(client, cfg, payload)
        return
    if kind == "event":
        _run_event(client, cfg, payload)
        return
    print(f"personal-timeline unknown kind={kind}; ignoring", file=sys.stderr)
