import json
import os
import sys
from typing import Any

import httpx

from src.config import Settings, get_settings
from src.graph.lore_loop import _extract_json_object, _invoke_lore_llm
from src.llm.errors import is_rate_limit_error, is_retryable_llm_error, should_try_lore_provider_fallback

JOIN_VICINITY_DAILY_CAP = 2
# Process-local join_vicinity cap (resets on worker restart; Redis persistence deferred — IN-02).
_join_vicinity_counts: dict[str, dict[str, int]] = {}

NPC_DISPLAY_NAMES = {
    "npc-1": "林小满",
    "npc-2": "陈叔",
    "npc-3": "阿禾",
}


def _game_headers(settings: Settings) -> dict[str, str]:
    """
    Build HTTP headers for internal game server requests.
    
    Parameters:
        settings (Settings): Configuration object; if `settings.internal_worker_token` is set,
            an `Authorization: Bearer <token>` header will be included.
    
    Returns:
        dict[str, str]: HTTP headers with `Content-Type: application/json` and,
            when applicable, an `Authorization` header.
    """
    headers: dict[str, str] = {"Content-Type": "application/json"}
    if settings.internal_worker_token:
        headers["Authorization"] = f"Bearer {settings.internal_worker_token}"
    return headers


def _day_bucket(game_minute: int) -> str:
    """
    Map a game-minute to a day bucket index string.
    
    Normalizes the input minute into the range 0–1439 (modulo 1440), partitions the day into three 480-minute buckets, and returns the bucket index as `"0"`, `"1"`, or `"2"`.
    
    Parameters:
        game_minute (int): The game minute (may be outside 0–1439).
    
    Returns:
        bucket (str): `"0"` for minutes 0–479, `"1"` for 480–959, `"2"` for 960–1439.
    """
    minute = int(game_minute) % 1440
    return str(minute // 480)


def _join_vicinity_allowed(room_id: str, npc_id: str, game_minute: int) -> bool:
    """
    Check whether setting `joinVicinity` is allowed for the given room and NPC at the specified in-game minute.
    
    This decision is based on a process-local counter keyed by "{room_id}:{npc_id}" and bucketed by a day derived from `game_minute`; the allowance is granted only if the recorded count for the current bucket is less than the configured daily cap.
    
    Returns:
        True if the recorded count for the room+NPC in the current day bucket is less than the daily cap, False otherwise.
    """
    key = f"{room_id}:{npc_id}"
    bucket = _join_vicinity_counts.setdefault(key, {})
    day = _day_bucket(game_minute)
    return bucket.get(day, 0) < JOIN_VICINITY_DAILY_CAP


def _record_join_vicinity(room_id: str, npc_id: str, game_minute: int) -> None:
    """
    Increment the process-local counter that tracks how many times an NPC in a room has been allowed to join vicinity for the day bucket derived from `game_minute`.
    
    Parameters:
        room_id (str): Identifier of the room.
        npc_id (str): Identifier of the NPC.
        game_minute (int): Game minute used to compute the day bucket; the function maps this to a bucket and increments that bucket's count for the `{room_id}:{npc_id}` key.
    """
    key = f"{room_id}:{npc_id}"
    bucket = _join_vicinity_counts.setdefault(key, {})
    day = _day_bucket(game_minute)
    bucket[day] = bucket.get(day, 0) + 1


def clear_join_vicinity_counts_for_tests() -> None:
    """
    Clear the in-memory join-vicinity counters used by tests.
    
    This resets the process-local tracking map that records how many times
    an NPC has been allowed to set `joinVicinity` per room and day bucket.
    """
    _join_vicinity_counts.clear()


def _intent_provider(settings: Settings) -> tuple[str, str]:
    """
    Selects the LLM provider and model to use for intent generation.
    
    If `settings.llm_provider_reflect` is set (after trimming and lowercasing), returns that provider with `settings.llm_model_reflect`.
    Otherwise returns `settings.llm_provider_lore` if present (falling back to `settings.llm_provider`) paired with `settings.llm_model_lore_t0` if set, otherwise `settings.llm_model`.
    
    Parameters:
        settings (Settings): Configuration containing LLM provider/model fields.
    
    Returns:
        tuple[str, str]: (provider, model) where `provider` is the chosen provider string (lowercased and trimmed) and `model` is the chosen model name.
    """
    reflect = (settings.llm_provider_reflect or "").strip().lower()
    lore = (settings.llm_provider_lore or settings.llm_provider).strip().lower()
    if reflect:
        return reflect, settings.llm_model_reflect
    return lore, settings.llm_model_lore_t0 or settings.llm_model


def _segment(payload: dict[str, Any]) -> dict[str, Any]:
    """
    Return the payload's "segment" mapping or an empty dict when it's missing or falsy.
    
    Returns:
        dict: The value of `payload["segment"]` if present and truthy, otherwise an empty dictionary.
    """
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
    """
    Return the substring of a zone identifier after the last ':'.
    
    If no ':' is present in `zone_id`, returns `zone_id` unchanged.
    
    Returns:
        str: The suffix after the final colon, or the original `zone_id` if none exists.
    """
    idx = zone_id.rfind(":")
    return zone_id[idx + 1 :] if idx >= 0 else zone_id


def _fallback_reason(npc_id: str, zone_id: str) -> str:
    """
    Select a fallback Chinese reason for an NPC based on the zone.
    
    Parameters:
        npc_id (str): NPC identifier used to choose the reason pool.
        zone_id (str): Zone identifier; the zone suffix is used to select a zone-specific reason.
    
    Returns:
        reasonZh (str): A short Chinese reason chosen from the NPC's reason pool for the zone suffix,
        or the pool's "default" entry, or "心里有点事" if no entry is available.
    """
    pools = _FALLBACK_REASON_BY_NPC.get(npc_id) or _FALLBACK_REASON_BY_NPC["npc-1"]
    suffix = _zone_suffix(zone_id)
    return pools.get(suffix) or pools.get("default") or "心里有点事"


def _fallback_intent(payload: dict[str, Any]) -> dict[str, Any]:
    """
    Build a simple rule-based ambient intent when LLM generation is unavailable.
    
    Parameters:
        payload (dict): Job payload that may contain:
            - "segment" (dict): optional. If present, "toMinute" (int) limits intent duration and
              "zoneId" (str) selects the zone.
            - "npcId" (str): optional NPC identifier used to choose a fallback reason.
    
    Returns:
        dict: An intent object with keys:
            - "zoneId" (str): chosen zone ID (defaults to "home-yard").
            - "reasonZh" (str): a short Chinese reason selected from rule pools.
            - "untilGameMinute" (int): intent expiry minute clamped to the range 0–1439.
    """
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
    """
    Builds a deterministic mock ambient intent for an NPC.
    
    Parameters:
        payload (dict): Input payload that may contain:
            - "segment" (dict): optional; may include "toMinute" (int) and "zoneId" (str) used to set intent duration and zone.
            - "roomId" (str): optional; identifies the room for join-vicinity rate limiting.
            - "npcId" (str): optional; identifies the NPC for join-vicinity rate limiting.
            - "gameMinute" (int): optional; current game minute used for rate limiting.
    
    Returns:
        dict: An intent object with keys:
            - "zoneId" (str): target zone for the intent.
            - "reasonZh" (str): Chinese reason text ("随便逛逛").
            - "untilGameMinute" (int): clamped minute in [0, 1439] when the intent ends.
            - "joinVicinity" (bool, optional): present and true if allowed by per-room/NPC daily cap.
    """
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
    """
    Normalize a raw intent (typically from an LLM) into the final server-ready intent shape.
    
    Converts and clamps `untilGameMinute`, truncates `reasonZh` to 32 characters, enforces the per-worker `joinVicinity` cap, and chooses between a `target:{gx,gy}` shape or a `zoneId` shape. If `joinVicinity` is allowed and present, records the join usage.
    
    Parameters:
        raw (dict): The raw intent object; may contain `reasonZh`, `untilGameMinute`, `joinVicinity`, `target`, and/or `zoneId`.
        payload (dict): Job payload used for defaults and context (reads `segment`, `roomId`, `npcId`, `gameMinute`).
        settings (Settings): Application settings (passed through for consistency; not inspected here).
    
    Returns:
        dict: Normalized intent with one of:
            - { "target": {"gx": int, "gy": int}, "reasonZh": str, "untilGameMinute": int, [ "joinVicinity": True ] }
            - { "zoneId": str, "reasonZh": str, "untilGameMinute": int, [ "joinVicinity": True ] }
    """
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


def generate_ambient_intent(payload: dict[str, Any], settings: Settings) -> dict[str, Any]:
    """
    Generate a short-term ambient intent for an NPC, preferring an LLM-generated JSON intent (or mock mode) and falling back to a rule-based intent on failure.
    
    Parameters:
        payload (dict): Job payload containing NPC and segment context. Expected keys used include:
            - "npcId": NPC identifier.
            - "segment": optional dict with "zoneId", "activityKey", "mobility", "toMinute".
            - "trigger": optional trigger string.
            - "roomId", "gameMinute", "jobId", "initiatorPlayerId": passed through to posting logic elsewhere.
        settings (Settings): Runtime configuration that controls LLM selection, mock mode, and related behavior.
    
    Returns:
        dict: A normalized intent object ready for the game server. Contains:
            - "reasonZh" (str): short Chinese reason/motive (truncated to 32 chars).
            - "untilGameMinute" (int): minute in range 0–1439 when the intent expires.
            - Either:
                - "target" (dict): { "gx": int, "gy": int } grid target, or
                - "zoneId" (str): destination zone id string.
            - Optional "joinVicinity" (True) when allowed and recorded.
    """
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

    provider, model = _intent_provider(settings)
    last_exc: BaseException | None = None
    for prov, mod in [(provider, model)]:
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
    """
    Post an NPC ambient intent to the game server for the room specified in the payload.
    
    Parameters:
        client (httpx.Client): HTTP client used to perform the request.
        settings (Settings): Configuration containing `game_server_url` and optional auth token.
        payload (dict): Job payload; expected keys include `roomId`, `npcId`, `trigger`, `gameMinute`, `jobId`, and optionally `initiatorPlayerId`. `roomId` defaults to `"default"` when missing.
        intent (dict): Normalized intent object to send under the `intent` field.
    
    Raises:
        httpx.HTTPStatusError: If the server responds with a non-2xx status (raised by `res.raise_for_status()`).
    """
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
    """
    Clear server-side pending ambient intent for an NPC.
    
    Sends a POST to "{game_server_url}/internal/rooms/{roomId}/npc-intent/pending-clear" with a JSON body containing `npcId` and `jobId`. `roomId` is taken from `payload["roomId"]` or defaults to "default" when missing or falsy.
    
    Parameters:
        payload (dict): Request payload containing:
            roomId (str, optional): Room identifier; defaults to "default" when missing or falsy.
            npcId (str): NPC identifier whose pending intent should be cleared.
            jobId (str): Job identifier associated with the pending intent.
    
    Raises:
        httpx.HTTPStatusError: If the server responds with a non-2xx status.
    """
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
    """
    Run the end-to-end ambient intent job for an NPC: generate an intent, post it to the game server, and clear pending intent state.
    
    Parameters:
        payload (dict[str, Any]): Job payload containing keys such as `roomId`, `npcId`, `gameMinute`, `jobId`, `trigger`, and optional `initiatorPlayerId`. Used to generate and route the intent.
        settings (Settings | None): Optional configuration; when omitted the global settings loader is used.
        client (httpx.Client | None): Optional HTTP client to use for server requests; when omitted a new client is created and closed by this function.
    
    Raises:
        Exception: Re-raises any exception encountered during intent generation or posting after attempting to post a fallback intent. Any failures to clear pending state or close the created HTTP client are logged but do not suppress the original exception.
    """
    cfg = settings or get_settings()
    owns_client = client is None
    http = client or httpx.Client()
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
