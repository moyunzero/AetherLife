import json
import os
import re
import sys
from typing import Any

import httpx

from src.config import Settings, get_settings
from src.llm.errors import is_rate_limit_error, is_retryable_llm_error, should_try_lore_provider_fallback
from src.llm.factory import PROVIDER_BASE_URLS, create_chat_model
from src.llm.openrouter_keys import openrouter_keys

LORE_JSON_FIELDS = (
    "nameZh",
    "flavorOneLine",
    "storyHook",
    "proceduralBiome",
    "moodTag",
    "npcRumor",
    "hiddenQuestSeed",
)

VALID_BIOMES = frozenset({"home", "meadow", "scrub", "wetland", "highland"})


def _game_headers(settings: Settings) -> dict[str, str]:
    headers: dict[str, str] = {"Content-Type": "application/json"}
    if settings.internal_worker_token:
        headers["Authorization"] = f"Bearer {settings.internal_worker_token}"
    return headers


def _lore_model(settings: Settings, model_tier: str) -> tuple[str, str]:
    tier = (model_tier or "T0").upper()
    if tier == "T1" and settings.llm_model_lore_t1:
        provider = (settings.llm_provider_lore or settings.llm_provider).lower()
        return provider, settings.llm_model_lore_t1
    if settings.llm_model_lore_t0:
        provider = (settings.llm_provider_lore or settings.llm_provider).lower()
        return provider, settings.llm_model_lore_t0
    provider = (settings.llm_provider_lore or settings.llm_provider).lower()
    return provider, settings.llm_model


def _mock_lore(dominant_biome: str) -> dict[str, str]:
    biome = dominant_biome if dominant_biome in VALID_BIOMES else "meadow"
    return {
        "nameZh": "风息浅滩",
        "flavorOneLine": "露水在草叶上滚成小小的光点",
        "storyHook": "据说每逢清晨，会有迷路的小兽在这里留下脚印。",
        "proceduralBiome": biome,
        "moodTag": "宁静",
        "npcRumor": "村民说这里的萤火虫比别处更亮。",
        "hiddenQuestSeed": "mock-seed-no-quest",
    }


def _extract_json_object(text: str) -> dict[str, Any]:
    raw = (text or "").strip()
    if not raw:
        raise ValueError("empty LLM response")
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", raw)
    if fence:
        raw = fence.group(1).strip()
    start = raw.find("{")
    end = raw.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError("no JSON object in LLM response")
    return json.loads(raw[start : end + 1])


def _lore_provider_attempts(settings: Settings, model_tier: str) -> list[tuple[str, str]]:
    primary = _lore_model(settings, model_tier)
    attempts = [primary]
    fallback = (settings.llm_provider_lore_fallback or os.getenv("LLM_PROVIDER_LORE_FALLBACK") or "").strip().lower()
    if fallback and fallback in PROVIDER_BASE_URLS and fallback != primary[0]:
        fb_model = os.getenv("LLM_MODEL_LORE_FALLBACK", "").strip()
        if not fb_model:
            if fallback == "groq":
                fb_model = "llama-3.1-8b-instant"
            elif fallback == "agnes":
                fb_model = settings.llm_model_reflect or "agnes-2.0-flash"
            elif fallback == "zhipu":
                fb_model = os.getenv("LLM_MODEL_LORE_FALLBACK", "").strip() or "glm-4.7-flash"
            elif fallback == "cerebras":
                fb_model = (
                    os.getenv("LLM_MODEL_LORE_FALLBACK", "").strip()
                    or os.getenv("LLM_MODEL_CEREBRAS", "").strip()
                    or "gpt-oss-120b"
                )
            elif fallback == "siliconflow":
                fb_model = (
                    os.getenv("LLM_MODEL_LORE_FALLBACK", "").strip()
                    or settings.llm_model_siliconflow_reason
                )
            elif fallback == "nvidia":
                fb_model = (
                    os.getenv("LLM_MODEL_LORE_FALLBACK", "").strip()
                    or settings.llm_model_nvidia_lore
                )
            elif fallback == "openrouter":
                fb_model = (
                    os.getenv("LLM_MODEL_LORE_FALLBACK", "").strip()
                    or settings.llm_model_openrouter_fallback
                )
            else:
                fb_model = settings.llm_model
        attempts.append((fallback, fb_model))

    fallback_2 = (
        settings.llm_provider_lore_fallback_2
        or os.getenv("LLM_PROVIDER_LORE_FALLBACK_2")
        or ""
    ).strip().lower()
    if fallback_2 and fallback_2 in PROVIDER_BASE_URLS:
        used = {p for p, _ in attempts}
        if fallback_2 not in used:
            from src.llm.roles import default_model_for_provider

            attempts.append((fallback_2, default_model_for_provider(settings, fallback_2)))
    return attempts


def _invoke_lore_llm(
    settings: Settings,
    provider: str,
    model: str,
    prompt: str,
) -> str:
    keys: list[str | None] = openrouter_keys(settings) if provider == "openrouter" else [None]
    if provider == "openrouter" and not keys:
        keys = [None]
    last_exc: BaseException | None = None
    for key_idx, or_key in enumerate(keys):
        try:
            llm = create_chat_model(provider=provider, model=model, settings=settings, api_key=or_key)
            response = llm.invoke([{"role": "user", "content": prompt}])
            return str(getattr(response, "content", "") or "")
        except Exception as exc:
            last_exc = exc
            if provider == "openrouter" and is_rate_limit_error(exc) and key_idx + 1 < len(keys):
                print(
                    f"lore OpenRouter key #{key_idx + 1} rate-limited, trying next key",
                    file=sys.stderr,
                )
                continue
            if is_retryable_llm_error(exc):
                raise
            raise
    assert last_exc is not None
    raise last_exc


def generate_lore_llm(payload: dict[str, Any], settings: Settings) -> dict[str, str]:
    dominant = str(payload.get("dominantBiome") or "meadow")
    walkable = payload.get("walkableRatio")
    cx = payload.get("cx")
    cy = payload.get("cy")
    if settings.llm_mock or os.getenv("LLM_MOCK") == "1":
        return _mock_lore(dominant)

    prompt = (
        "你是《动物森友会》风格的轻叙事写手。为一块 8×8 程序化地块写中文 lore。\n"
        f"服务器 dominantBiome={dominant}，walkableRatio≈{walkable}，chunk=({cx},{cy})。\n"
        "必须输出单个 JSON 对象，字段："
        "nameZh(≤32字), flavorOneLine(≤80字), storyHook(≤200字), "
        f"proceduralBiome(必须等于 {dominant}), moodTag(≤24字), "
        "npcRumor(≤160字), hiddenQuestSeed(≤120字)。\n"
        " whimsical、温暖、无暴力；不要 contradict dominantBiome；不要 markdown。"
    )

    tier = str(payload.get("modelTier") or "T0")
    last_exc: BaseException | None = None
    for provider, model in _lore_provider_attempts(settings, tier):
        try:
            raw = _invoke_lore_llm(settings, provider, model, prompt)
            data = _extract_json_object(raw)
            return {k: str(data.get(k, "")).strip() for k in LORE_JSON_FIELDS}
        except Exception as exc:
            last_exc = exc
            if should_try_lore_provider_fallback(exc):
                print(
                    f"lore provider={provider} model={model} failed ({type(exc).__name__}), trying fallback",
                    file=sys.stderr,
                )
                continue
            raise
    assert last_exc is not None
    raise last_exc


def validate_lore(lore: dict[str, str], dominant_biome: str) -> None:
    for key in LORE_JSON_FIELDS:
        if not lore.get(key):
            raise ValueError(f"missing field {key}")
    if lore["proceduralBiome"] not in VALID_BIOMES:
        raise ValueError("invalid proceduralBiome")
    if dominant_biome and lore["proceduralBiome"] != dominant_biome:
        raise ValueError("proceduralBiome mismatch")


def _lore_post_url(settings: Settings, payload: dict[str, Any]) -> str:
    world_id = payload.get("worldId") or payload.get("mapRoomId") or "default"
    cx = int(payload["cx"])
    cy = int(payload["cy"])
    return f"{settings.game_server_url}/internal/world/{world_id}/chunks/{cx}/{cy}/lore"


def post_lore_success(
    client: httpx.Client,
    settings: Settings,
    payload: dict[str, Any],
    lore: dict[str, str],
) -> None:
    body = {
        "lore": lore,
        "dominantBiome": payload.get("dominantBiome"),
        "modelTier": payload.get("modelTier") or "T0",
        "mapRoomId": payload.get("mapRoomId") or payload.get("worldId"),
    }
    res = client.post(_lore_post_url(settings, payload), json=body, headers=_game_headers(settings), timeout=30.0)
    res.raise_for_status()


def post_lore_failed(client: httpx.Client, settings: Settings, payload: dict[str, Any]) -> None:
    body = {
        "failed": True,
        "mapRoomId": payload.get("mapRoomId") or payload.get("worldId"),
    }
    res = client.post(_lore_post_url(settings, payload), json=body, headers=_game_headers(settings), timeout=15.0)
    res.raise_for_status()


def run_lore_job(
    payload: dict[str, Any],
    *,
    settings: Settings | None = None,
    client: httpx.Client | None = None,
) -> None:
    cfg = settings or get_settings()
    dominant = str(payload.get("dominantBiome") or "meadow")
    owns_client = client is None
    http = client or httpx.Client()
    try:
        lore = generate_lore_llm(payload, cfg)
        validate_lore(lore, dominant)
        post_lore_success(http, cfg, payload, lore)
        print(
            f"[lore_complete] world={payload.get('worldId')} chunk=({payload.get('cx')},{payload.get('cy')})",
            file=sys.stderr,
        )
    except Exception as exc:
        print(
            f"lore job failed jobId={payload.get('jobId')}: {exc}",
            file=sys.stderr,
        )
        try:
            post_lore_failed(http, cfg, payload)
        except Exception as post_exc:
            print(f"lore failure callback failed: {post_exc}", file=sys.stderr)
        raise
    finally:
        if owns_client:
            http.close()
