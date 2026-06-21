"""Ambient NPC intent graph — LLM-driven background behavior between speak turns.

join_vicinity daily cap (JOIN_VICINITY_DAILY_CAP) is process-local in _join_vicinity_counts;
worker restart resets counts (no Redis persistence yet).
"""
import json
import os
import sys
from typing import Any

import httpx

from src.config import Settings, get_settings
from src.http_json import create_http_client
from src.graph.lore_loop import _extract_json_object, _invoke_lore_llm, _lore_provider_attempts
from src.llm.errors import is_rate_limit_error, is_retryable_llm_error, should_try_lore_provider_fallback

JOIN_VICINITY_DAILY_CAP = 2
_join_vicinity_counts: dict[str, dict[str, int]] = {}

NPC_DISPLAY_NAMES = {
    "npc-1": "林小满",
    "npc-2": "陈叔",
    "npc-3": "阿禾",
}


def _game_headers(settings: Settings) -> dict[str, str]:
    headers: dict[str, str] = {"Content-Type": "application/json"}
    if settings.internal_worker_token:
        headers["Authorization"] = f"Bearer {settings.internal_worker_token}"
    return headers


def _day_bucket(game_minute: int) -> str:
    minute = int(game_minute) % 1440
    return str(minute // 480)


def _join_vicinity_allowed(room_id: str, npc_id: str, game_minute: int) -> bool:
    key = f"{room_id}:{npc_id}"
    bucket = _join_vicinity_counts.setdefault(key, {})
    day = _day_bucket(game_minute)
    return bucket.get(day, 0) < JOIN_VICINITY_DAILY_CAP


def _record_join_vicinity(room_id: str, npc_id: str, game_minute: int) -> None:
    key = f"{room_id}:{npc_id}"
    bucket = _join_vicinity_counts.setdefault(key, {})
    day = _day_bucket(game_minute)
    bucket[day] = bucket.get(day, 0) + 1


def clear_join_vicinity_counts_for_tests() -> None:
    _join_vicinity_counts.clear()


def _intent_provider(settings: Settings) -> tuple[str, str]:
    reflect = (settings.llm_provider_reflect or "").strip().lower()
    lore = (settings.llm_provider_lore or settings.llm_provider).strip().lower()
    if reflect:
        return reflect, settings.llm_model_reflect
    return lore, settings.llm_model_lore_t0 or settings.llm_model


def _segment(payload: dict[str, Any]) -> dict[str, Any]:
    return payload.get("segment") or {}


_FALLBACK_REASON_BY_NPC: dict[str, dict[str, str]] = {
    "npc-1": {
        "orchard": "心里还惦记着件事",
        "plaza": "想听听大家最近在忙啥",
        "default": "先把念头安放好",
    },
    "npc-2": {
        "orchard": "手头的活计得抓紧",
        "plaza": "看看有没有能帮上忙的",
        "default": "先把正事想好",
    },
    "npc-3": {
        "orchard": "有话想直说就别憋着",
        "plaza": "看看广场里有什么新鲜事",
        "default": "直来直去省得误会",
    },
}


def _zone_suffix(zone_id: str) -> str:
    idx = zone_id.rfind(":")
    return zone_id[idx + 1 :] if idx >= 0 else zone_id


def _fallback_reason(npc_id: str, zone_id: str) -> str:
    pools = _FALLBACK_REASON_BY_NPC.get(npc_id) or _FALLBACK_REASON_BY_NPC["npc-1"]
    suffix = _zone_suffix(zone_id)
    return pools.get(suffix) or pools.get("default") or "心里有点事"


def _fallback_intent(payload: dict[str, Any]) -> dict[str, Any]:
    segment = _segment(payload)
    until = int(segment.get("toMinute") or 1439)
    zone_id = str(segment.get("zoneId") or "home-yard")
    npc_id = str(payload.get("npcId") or "npc-1")
    reason_zh = _fallback_reason(npc_id, zone_id)
    return {
        "zoneId": zone_id,
        "reasonZh": reason_zh,
        "untilGameMinute": max(0, min(1439, until)),
    }


def _mock_intent(payload: dict[str, Any]) -> dict[str, Any]:
    segment = _segment(payload)
    until = int(segment.get("toMinute") or 1439)
    zone_id = str(segment.get("zoneId") or "home-yard")
    intent: dict[str, Any] = {
        "zoneId": zone_id,
        "reasonZh": "随便逛逛",
        "untilGameMinute": max(0, min(1439, until)),
    }
    room_id = str(payload.get("roomId") or "default")
    npc_id = str(payload.get("npcId") or "npc-1")
    game_minute = int(payload.get("gameMinute") or 0)
    if _join_vicinity_allowed(room_id, npc_id, game_minute):
        intent["joinVicinity"] = True
        _record_join_vicinity(room_id, npc_id, game_minute)
    return intent


def _normalize_intent(raw: dict[str, Any], payload: dict[str, Any], settings: Settings) -> dict[str, Any]:
    segment = _segment(payload)
    reason_zh = str(raw.get("reasonZh") or "")[:32]
    until_raw = raw.get("untilGameMinute")
    until = int(until_raw if until_raw is not None else segment.get("toMinute") or 1439)
    until = max(0, min(1439, until))

    join = bool(raw.get("joinVicinity"))
    room_id = str(payload.get("roomId") or "default")
    npc_id = str(payload.get("npcId") or "npc-1")
    game_minute = int(payload.get("gameMinute") or 0)
    if join and not _join_vicinity_allowed(room_id, npc_id, game_minute):
        join = False

    target = raw.get("target")
    if isinstance(target, dict) and "gx" in target and "gy" in target:
        intent: dict[str, Any] = {
            "target": {"gx": int(target["gx"]), "gy": int(target["gy"])},
            "reasonZh": reason_zh,
            "untilGameMinute": until,
        }
    else:
        zone_id = str(raw.get("zoneId") or segment.get("zoneId") or "home-yard")
        intent = {
            "zoneId": zone_id,
            "reasonZh": reason_zh,
            "untilGameMinute": until,
        }

    if join:
        intent["joinVicinity"] = True
        _record_join_vicinity(room_id, npc_id, game_minute)
    return intent


def _ambient_provider_attempts(settings: Settings) -> list[tuple[str, str]]:
    primary = _intent_provider(settings)
    attempts: list[tuple[str, str]] = [primary]
    seen = {primary[0]}
    for prov, mod in _lore_provider_attempts(settings, "t0"):
        if prov not in seen:
            attempts.append((prov, mod))
            seen.add(prov)
    return attempts


def generate_ambient_intent(payload: dict[str, Any], settings: Settings) -> dict[str, Any]:
    if settings.llm_mock or os.getenv("LLM_MOCK") == "1":
        return _mock_intent(payload)

    segment = _segment(payload)
    npc_id = str(payload.get("npcId") or "npc-1")
    npc_name = NPC_DISPLAY_NAMES.get(npc_id, npc_id)
    zone_id = str(segment.get("zoneId") or "home-yard")
    activity_key = str(segment.get("activityKey") or "idle")
    mobility = str(segment.get("mobility") or "wander")
    trigger = str(payload.get("trigger") or "segment_change")

    prompt = (
        "你是生活模拟游戏的 NPC 短途意图规划器。只输出一个 JSON 对象，不要 markdown。\n"
        f"NPC={npc_name}({npc_id}) trigger={trigger} zoneId={zone_id} activity={activity_key} mobility={mobility}。\n"
        "字段：reasonZh(≤32字中文，只写动机/情绪/短期社交意图，12–18字；禁止复述当前 activity 行为)；"
        "untilGameMinute(0-1439，本段日程结束前有效)；"
        "二选一：target{gx,gy} 格子目标，或 zoneId 字符串；"
        "可选 joinVicinity=true（仅当 NPC 想主动靠近玩家闲聊时，每天最多2次）。\n"
        "示例：activity=reading 时 reasonZh 应为「想找安静角落」而非「在看书」；"
        "activity=patrol 时可用「心里还惦记着件事」而非「四处巡逻」。\n"
        "禁止暴力、禁止 apply-actions、禁止 tool_calls。"
    )

    last_exc: BaseException | None = None
    for prov, mod in _ambient_provider_attempts(settings):
        try:
            raw_text = _invoke_lore_llm(settings, prov, mod, prompt)
            data = _extract_json_object(raw_text)
            return _normalize_intent(data, payload, settings)
        except Exception as exc:
            last_exc = exc
            if should_try_lore_provider_fallback(exc):
                print(
                    f"ambient intent provider={prov} model={mod} failed ({type(exc).__name__}), fallback",
                    file=sys.stderr,
                )
                continue
            if is_retryable_llm_error(exc) or is_rate_limit_error(exc):
                break
            break
    print(f"ambient intent LLM failed, using rule fallback: {last_exc}", file=sys.stderr)
    return _fallback_intent(payload)


def post_ambient_intent(
    client: httpx.Client,
    settings: Settings,
    payload: dict[str, Any],
    intent: dict[str, Any],
) -> None:
    room_id = str(payload.get("roomId") or "default")
    body: dict[str, Any] = {
        "npcId": payload.get("npcId"),
        "intent": intent,
        "trigger": payload.get("trigger") or "segment_change",
        "gameMinute": payload.get("gameMinute"),
        "jobId": payload.get("jobId"),
    }
    initiator = payload.get("initiatorPlayerId")
    if isinstance(initiator, str) and initiator.strip():
        body["initiatorPlayerId"] = initiator.strip()
    url = f"{settings.game_server_url}/internal/rooms/{room_id}/npc-intent"
    res = client.post(url, json=body, headers=_game_headers(settings), timeout=20.0)
    res.raise_for_status()


def clear_ambient_pending(
    client: httpx.Client,
    settings: Settings,
    payload: dict[str, Any],
) -> None:
    room_id = str(payload.get("roomId") or "default")
    body = {
        "npcId": payload.get("npcId"),
        "jobId": payload.get("jobId"),
    }
    url = f"{settings.game_server_url}/internal/rooms/{room_id}/npc-intent/pending-clear"
    res = client.post(url, json=body, headers=_game_headers(settings), timeout=10.0)
    res.raise_for_status()


def run_ambient_intent_job(
    payload: dict[str, Any],
    *,
    settings: Settings | None = None,
    client: httpx.Client | None = None,
) -> None:
    cfg = settings or get_settings()
    owns_client = client is None
    http = client or create_http_client()
    try:
        intent = generate_ambient_intent(payload, cfg)
        post_ambient_intent(http, cfg, payload, intent)
        print(
            f"[ambient_intent] room={payload.get('roomId')} npc={payload.get('npcId')} "
            f"trigger={payload.get('trigger')} reason={intent.get('reasonZh')!r}",
            file=sys.stderr,
        )
    except Exception as exc:
        print(f"ambient intent job failed jobId={payload.get('jobId')}: {exc}", file=sys.stderr)
        try:
            post_ambient_intent(http, cfg, payload, _fallback_intent(payload))
        except Exception as post_exc:
            print(f"ambient intent fallback POST failed: {post_exc}", file=sys.stderr)
        raise
    finally:
        try:
            clear_ambient_pending(http, cfg, payload)
        except Exception as clear_exc:
            print(f"ambient intent pending-clear failed: {clear_exc}", file=sys.stderr)
        if owns_client:
            http.close()
