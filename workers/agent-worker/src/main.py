import json
import os
import sys

import httpx
import redis

from src.config import Settings, get_settings
from src.graph.npc_loop import run_npc_turn
from src.persistence.checkpointer import setup_checkpointer
from src.guard.reply_audit import audit_reply
from src.llm.errors import format_llm_error

BRIDGE_LIST_KEY = "aetherlife:npc-turn:jobs"
BLPOP_TIMEOUT_S = 5


def create_redis_client(redis_url: str) -> redis.Redis:
    """Upstash + BLPOP needs socket_timeout=None so block timeout is not treated as socket error."""
    client = redis.from_url(
        redis_url,
        decode_responses=True,
        socket_timeout=None,
        socket_connect_timeout=15,
        retry_on_timeout=True,
        health_check_interval=30,
    )
    client.ping()
    return client


def configure_langsmith(settings: Settings) -> None:
    if settings.llm_mock:
        return
    api_key = os.getenv("LANGCHAIN_API_KEY")
    if api_key:
        os.environ.setdefault("LANGCHAIN_TRACING_V2", "true")
        os.environ.setdefault("LANGCHAIN_PROJECT", os.getenv("LANGCHAIN_PROJECT", "aetherlife-dev"))


def emit_job_event(
    client: httpx.Client,
    settings: Settings,
    job_id: str,
    event_type: str,
    data: dict,
) -> None:
    headers = {}
    if settings.internal_worker_token:
        headers["Authorization"] = f"Bearer {settings.internal_worker_token}"
    res = client.post(
        f"{settings.game_server_url}/internal/jobs/{job_id}/emit",
        json={"type": event_type, "data": data},
        headers=headers,
        timeout=10.0,
    )
    res.raise_for_status()


def validate_llm_settings(settings: Settings) -> None:
    if settings.llm_mock:
        return
    from src.llm.factory import _api_key_for_provider

    _api_key_for_provider(settings, settings.llm_provider.lower())


def process_job(client: httpx.Client, settings: Settings, payload: dict) -> None:
    job_id = payload["jobId"]
    room_id = payload.get("roomId", "default")
    npc_id = payload.get("npcId", "npc-1")
    player_message = payload.get("playerMessage", "")
    player_id = payload.get("playerId", "__legacy__")

    emit_job_event(client, settings, job_id, "thinking", {"status": "planning", "npcId": npc_id})

    result = run_npc_turn(
        room_id=room_id,
        player_message=player_message,
        npc_id=npc_id,
        player_id=player_id,
        settings=settings,
    )
    reply = audit_reply(result.get("reply") or "", result.get("tool_calls") or [])
    trace_run_id = result.get("trace_run_id") or os.getenv("LANGCHAIN_RUN_ID")
    room_snapshot = result.get("room_snapshot") or {}
    npc_name = ""
    for npc in room_snapshot.get("npcs") or []:
        if npc.get("id") == npc_id:
            npc_name = str(npc.get("name") or "")
            break

    emit_job_event(
        client,
        settings,
        job_id,
        "done",
        {
            "reply": reply,
            "npcId": npc_id,
            "npcName": npc_name,
            "state": room_snapshot,
            "toolCalls": result.get("tool_calls") or [],
            "traceRunId": trace_run_id,
        },
    )


def run_mock() -> None:
    print(json.dumps({"reply": "（模拟）我听到了你的话。", "toolCalls": []}, ensure_ascii=False))


def run_worker() -> None:
    settings = get_settings()
    configure_langsmith(settings)
    print(
        f"agent-worker ready provider={settings.llm_provider} model={settings.llm_model}",
        file=sys.stderr,
    )

    if settings.llm_mock and not settings.redis_url:
        run_mock()
        return

    if not settings.redis_url:
        print("REDIS_URL not set; idle", file=sys.stderr)
        return

    try:
        validate_llm_settings(settings)
    except ValueError as exc:
        print(f"LLM config error: {exc}", file=sys.stderr)
        sys.exit(1)

    try:
        setup_checkpointer(
            database_url=settings.database_url,
            allow_memory_fallback=settings.llm_mock,
        )
        print("PostgresSaver checkpointer ready", file=sys.stderr)
    except RuntimeError as exc:
        print(f"Checkpoint error: {exc}", file=sys.stderr)
        sys.exit(1)

    r = create_redis_client(settings.redis_url)
    print("connected to Redis; waiting for npc-turn jobs", file=sys.stderr)

    with httpx.Client() as client:
        while True:
            try:
                item = r.blpop(BRIDGE_LIST_KEY, timeout=BLPOP_TIMEOUT_S)
            except redis.exceptions.TimeoutError:
                # Idle poll — no job within BLPOP timeout
                continue
            except redis.exceptions.ConnectionError as exc:
                print(f"Redis connection lost: {exc}", file=sys.stderr)
                r = create_redis_client(settings.redis_url)
                continue

            if not item:
                continue
            _, raw = item
            payload = json.loads(raw)
            print(f"job received jobId={payload.get('jobId')}", file=sys.stderr)
            try:
                process_job(client, settings, payload)
            except Exception as exc:
                print(f"job failed jobId={payload.get('jobId')}: {exc}", file=sys.stderr)
                emit_job_event(
                    client,
                    settings,
                    payload["jobId"],
                    "error",
                    {"message": format_llm_error(exc)},
                )


def main() -> None:
    settings = get_settings()
    if os.getenv("LLM_MOCK") == "1" and not settings.redis_url:
        run_mock()
        return
    run_worker()


if __name__ == "__main__":
    main()
