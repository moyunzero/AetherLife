import json
import os
import sys
import threading
import time
from typing import Any

import httpx
import redis

from src.config import Settings, get_settings
from src.graph.ambient_intent import run_ambient_intent_job
from src.graph.lore_loop import run_lore_job
from src.graph.memory_quote import pick_memory_quote
from src.graph.casual_fast_lane import run_casual_fast_lane
from src.graph.npc_loop import run_npc_memory_tail, run_npc_turn_interactive
from src.graph.nodes.llm_social_turn import preview_casual_stub
from src.graph.action_intent import player_requests_physical_action
from src.graph.speak_intent import can_use_casual_fast_lane, can_use_social_edge_fast_lane
from src.graph.social_edge_fast_lane import run_social_edge_fast_lane
from src.graph.world_vote import process_world_vote_job
from src.graph.job_context import reset_job_context, set_job_context
from src.llm.call_budget import (
    get_recorder,
    llm_call_summary_payload,
    start_recorder,
    summarize_for_log,
)
from src.persistence.checkpointer import setup_checkpointer
from src.guard.reply_audit import audit_reply
from src.llm.errors import format_llm_error
from src.http_json import create_http_client
from src.memory.client import append_player_memory
from src.memory.importance import DEFAULT_IMPORTANCE

BRIDGE_LIST_KEY = "aetherlife:npc-turn:jobs"
LORE_BRIDGE_LIST_KEY = "aetherlife:chunk-lore:jobs"
AMBIENT_INTENT_BRIDGE_LIST_KEY = "aetherlife:npc-ambient-intent:jobs"
WORLD_VOTE_BRIDGE_LIST_KEY = "aetherlife:world-vote:jobs"
BLPOP_TIMEOUT_S = 5
LORE_BLPOP_TIMEOUT_S = 1
AMBIENT_BLPOP_TIMEOUT_S = 1
_speak_in_progress = False
_speak_lock = threading.Lock()


def _is_speak_in_progress() -> bool:
    with _speak_lock:
        return _speak_in_progress


def _set_speak_in_progress(value: bool) -> None:
    global _speak_in_progress
    with _speak_lock:
        _speak_in_progress = value


def _parse_bridge_payload(raw: str, *, queue: str) -> dict | None:
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        print(f"invalid {queue} job JSON: {exc}", file=sys.stderr)
        return None
    if not isinstance(payload, dict):
        print(f"invalid {queue} job payload (expected object)", file=sys.stderr)
        return None
    return payload


def _job_id_from_payload(payload: dict) -> str:
    job_id = payload.get("jobId")
    if isinstance(job_id, str) and job_id.strip():
        return job_id.strip()
    return "unknown"


def create_redis_client(redis_url: str) -> redis.Redis:
    """Upstash + blocking pop needs socket_timeout=None so block timeout is not treated as socket error."""
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
    url = f"{settings.game_server_url}/internal/jobs/{job_id}/emit"
    payload = {"type": event_type, "data": data}
    retryable = frozenset({502, 503, 504})
    last: httpx.HTTPStatusError | None = None
    for attempt in range(3):
        res = client.post(url, json=payload, headers=headers, timeout=10.0)
        try:
            res.raise_for_status()
            return
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code not in retryable or attempt >= 2:
                raise
            last = exc
            time.sleep(1 + attempt)


def validate_llm_settings(settings: Settings) -> None:
    if settings.llm_mock:
        return
    from src.llm.factory import _api_key_for_provider

    _api_key_for_provider(settings, settings.llm_provider.lower())


def process_lore_job(client: httpx.Client, settings: Settings, payload: dict) -> None:
    print(
        f"lore job received jobId={payload.get('jobId')} chunk=({payload.get('cx')},{payload.get('cy')})",
        file=sys.stderr,
    )
    run_lore_job(payload, settings=settings, client=client)


def process_ambient_intent_job(client: httpx.Client, settings: Settings, payload: dict) -> None:
    print(
        f"ambient intent job received jobId={payload.get('jobId')} npc={payload.get('npcId')}",
        file=sys.stderr,
    )
    run_ambient_intent_job(payload, settings=settings, client=client)


def process_world_vote_job_wrapper(client: httpx.Client, settings: Settings, payload: dict) -> None:
    process_world_vote_job(client, settings, payload)


def drain_one_world_vote_job(r: redis.Redis, client: httpx.Client, settings: Settings) -> bool:
    """Lowest priority — defer when speak or npc-turn backlog active."""
    if _is_speak_in_progress() or r.llen(BRIDGE_LIST_KEY) > 0:
        return False
    raw = r.rpop(WORLD_VOTE_BRIDGE_LIST_KEY)
    if not raw:
        return False
    payload = _parse_bridge_payload(raw, queue="world-vote")
    if not payload:
        return True
    try:
        process_world_vote_job_wrapper(client, settings, payload)
    except Exception as exc:
        print(f"world-vote job error jobId={payload.get('jobId')}: {exc}", file=sys.stderr)
    return True


def drain_one_ambient_intent_job(r: redis.Redis, client: httpx.Client, settings: Settings) -> bool:
    if _is_speak_in_progress() or r.llen(BRIDGE_LIST_KEY) > 0:
        return False
    raw = r.rpop(AMBIENT_INTENT_BRIDGE_LIST_KEY)
    if not raw:
        return False
    payload = _parse_bridge_payload(raw, queue="ambient-intent")
    if not payload:
        return True
    try:
        process_ambient_intent_job(client, settings, payload)
    except Exception as exc:
        print(f"ambient intent job error jobId={payload.get('jobId')}: {exc}", file=sys.stderr)
    return True


def drain_one_lore_job(r: redis.Redis, client: httpx.Client, settings: Settings) -> bool:
    """Process at most one pending chunk-lore job (non-blocking). Returns True if handled."""
    if _is_speak_in_progress() or r.llen(BRIDGE_LIST_KEY) > 0:
        return False
    # game-server LPUSH → RPOP oldest first (FIFO), same as main-loop BRPOP
    raw = r.rpop(LORE_BRIDGE_LIST_KEY)
    if not raw:
        return False
    payload = _parse_bridge_payload(raw, queue="lore")
    if not payload:
        return True
    try:
        process_lore_job(client, settings, payload)
    except Exception as exc:
        print(f"lore job error jobId={payload.get('jobId')}: {exc}", file=sys.stderr)
    return True


def process_job(client: httpx.Client, settings: Settings, payload: dict) -> None:
    job_id = _job_id_from_payload(payload)
    if job_id == "unknown":
        raise ValueError("job payload missing jobId")
    room_id = payload.get("roomId", "default")
    npc_id = payload.get("npcId", "npc-1")
    player_message = payload.get("playerMessage", "")
    player_id = payload.get("playerId", "__legacy__")
    recent_turns = payload.get("recentTurns") or []

    emit_job_event(client, settings, job_id, "thinking", {"status": "planning", "npcId": npc_id})

    phase_timing: dict[str, int] = {}

    def partial_emit(text: str) -> None:
        emit_job_event(
            client,
            settings,
            job_id,
            "speakPartial",
            {"text": text, "npcId": npc_id},
        )

    ctx_tokens = set_job_context(partial_emit=partial_emit, phase_timing=phase_timing)
    start_recorder()
    t_job = time.perf_counter()
    _set_speak_in_progress(True)
    try:
        recent = recent_turns if isinstance(recent_turns, list) else []
        preview_already_emitted = bool(payload.get("casualPreviewEmitted"))
        _intent, fast_preview = can_use_casual_fast_lane(
            player_message, recent, npc_id=npc_id
        )
        _social_intent, social_preview = can_use_social_edge_fast_lane(
            player_message,
            recent,
            npc_id=npc_id,
        )
        if fast_preview is not None:
            if not preview_already_emitted:
                stub = preview_casual_stub(player_message, speak_intent=_intent.value)
                if stub:
                    partial_emit(stub)
            result = run_casual_fast_lane(
                room_id=room_id,
                player_message=player_message,
                npc_id=npc_id,
                player_id=player_id,
                recent_turns=recent,
                preview=fast_preview,
                settings=settings,
            )
        elif social_preview is not None and not player_requests_physical_action(player_message):
            partial_emit(social_preview.reply)
            result = run_social_edge_fast_lane(
                room_id=room_id,
                player_message=player_message,
                npc_id=npc_id,
                player_id=player_id,
                recent_turns=recent,
                preview=social_preview,
                settings=settings,
            )
        else:
            result = run_npc_turn_interactive(
                room_id=room_id,
                player_message=player_message,
                npc_id=npc_id,
                player_id=player_id,
                recent_turns=recent,
                settings=settings,
            )
    finally:
        _set_speak_in_progress(False)
        reset_job_context(ctx_tokens)
    perception = result.get("social_perception")
    if isinstance(perception, dict) and result.get("social_applied"):
        print(
            f"social applied jobId={job_id} npc={npc_id} kind={perception.get('kind')} "
            f"eff={result.get('effective_score')} collectiveUpdated={result.get('collective_updated')}",
            file=sys.stderr,
        )
    elif isinstance(perception, dict) and perception.get("kind") == "ignore":
        print(
            f"social skipped jobId={job_id} npc={npc_id} kind=ignore",
            file=sys.stderr,
        )
    reply = audit_reply(result.get("reply") or "", result.get("tool_calls") or [])
    trace_run_id = result.get("trace_run_id") or os.getenv("LANGCHAIN_RUN_ID")
    room_snapshot = result.get("room_snapshot") or {}
    npc_name = ""
    for npc in room_snapshot.get("npcs") or []:
        if npc.get("id") == npc_id:
            npc_name = str(npc.get("name") or "")
            break

    done_payload: dict[str, Any] = {
        "reply": reply,
        "npcId": npc_id,
        "npcName": npc_name,
        "state": room_snapshot,
        "toolCalls": result.get("tool_calls") or [],
        "traceRunId": trace_run_id,
    }
    speak_intent = result.get("speak_intent")
    if isinstance(speak_intent, str) and speak_intent.strip():
        done_payload["speakIntent"] = speak_intent.strip()
    phase_timing["t_worker_total_ms"] = int((time.perf_counter() - t_job) * 1000)
    if phase_timing:
        done_payload["phaseTimingMs"] = phase_timing
    if result.get("gate_rejected"):
        done_payload["gateRejected"] = True
        gate_kind = result.get("gate_kind")
        if isinstance(gate_kind, str) and gate_kind.strip():
            done_payload["gateKind"] = gate_kind.strip()
    if result.get("collective_updated"):
        done_payload["collectiveUpdated"] = True

    player_msg = str(player_message or "").strip()
    if player_msg:
        try:
            append_player_memory(
                client,
                settings,
                room_id,
                player_msg,
                importance=DEFAULT_IMPORTANCE,
                npc_id=npc_id,
                player_id=player_id,
            )
            result = {**result, "_player_line_persisted": True}
        except Exception as exc:
            print(
                f"fast player append failed jobId={job_id}: {exc}",
                file=sys.stderr,
            )

    memory_quote = pick_memory_quote(
        result.get("retrieved_memories"),
        int(result.get("memory_count") or 0),
        player_message=str(result.get("player_message") or player_message or ""),
    )
    if memory_quote:
        done_payload["memoryQuote"] = memory_quote

    interactive_recorder = get_recorder()
    interactive_summary = llm_call_summary_payload(interactive_recorder)
    if interactive_summary is not None:
        done_payload["llmCallSummary"] = interactive_summary
        print(
            f"llmCallSummary jobId={job_id} interactive={summarize_for_log(interactive_recorder)}",
            file=sys.stderr,
        )

    emit_job_event(
        client,
        settings,
        job_id,
        "done",
        done_payload,
    )

    def _memory_tail_worker() -> None:
        tail_started = time.perf_counter()
        start_recorder()
        try:
            run_npc_memory_tail(result, settings)
            elapsed_ms = int((time.perf_counter() - tail_started) * 1000)
            tail_recorder = get_recorder()
            if tail_recorder is not None and tail_recorder.total > 0:
                print(
                    f"llmCallSummary jobId={job_id} full={summarize_for_log(tail_recorder)} "
                    f"tailMs={elapsed_ms}",
                    file=sys.stderr,
                )
            else:
                print(f"memory tail ok jobId={job_id} tailMs={elapsed_ms}", file=sys.stderr)
        except Exception as exc:
            print(
                f"memory tail failed jobId={job_id} (player already got done): {exc}",
                file=sys.stderr,
            )

    threading.Thread(target=_memory_tail_worker, daemon=True).start()


def run_mock() -> None:
    print(json.dumps({"reply": "（模拟）我听到了你的话。", "toolCalls": []}, ensure_ascii=False))


def run_worker() -> None:
    settings = get_settings()
    configure_langsmith(settings)
    if settings.database_url and not os.getenv("DATABASE_URL"):
        os.environ["DATABASE_URL"] = settings.database_url
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
    stale_npc = r.llen(BRIDGE_LIST_KEY)
    if stale_npc:
        r.delete(BRIDGE_LIST_KEY)
        print(
            f"npc-turn bridge queue cleared on startup ({stale_npc} stale jobs)",
            file=sys.stderr,
        )
    print("connected to Redis; waiting for npc-turn + chunk-lore + ambient-intent jobs", file=sys.stderr)

    with create_http_client() as client:
        while True:
            try:
                # npc-turn first — lore flood must not starve speak jobs.
                # game-server LPUSH → BRPOP = FIFO (BLPOP would be LIFO / stack).
                item = r.brpop(BRIDGE_LIST_KEY, timeout=BLPOP_TIMEOUT_S)
                queue = "npc" if item else None
                if not item:
                    item = r.brpop(LORE_BRIDGE_LIST_KEY, timeout=LORE_BLPOP_TIMEOUT_S)
                    queue = "lore" if item else None
                if not item:
                    item = r.brpop(AMBIENT_INTENT_BRIDGE_LIST_KEY, timeout=AMBIENT_BLPOP_TIMEOUT_S)
                    queue = "ambient" if item else None
            except redis.exceptions.TimeoutError:
                continue
            except redis.exceptions.ConnectionError as exc:
                print(f"Redis connection lost: {exc}", file=sys.stderr)
                r = create_redis_client(settings.redis_url)
                continue

            if not item or not queue:
                drain_one_world_vote_job(r, client, settings)
                continue
            _, raw = item
            payload = _parse_bridge_payload(raw, queue=queue)
            if not payload:
                continue
            if queue == "npc":
                job_id = _job_id_from_payload(payload)
                print(
                    f"job received jobId={job_id} npc={payload.get('npcId')}",
                    file=sys.stderr,
                )
                try:
                    process_job(client, settings, payload)
                except Exception as exc:
                    print(f"job failed jobId={job_id}: {exc}", file=sys.stderr)
                    if job_id != "unknown":
                        err_msg = format_llm_error(exc, provider=settings.llm_provider)
                        try:
                            emit_job_event(
                                client,
                                settings,
                                job_id,
                                "error",
                                {"message": err_msg},
                            )
                        except Exception as emit_exc:
                            print(
                                f"failed to emit error for jobId={job_id}: {emit_exc}",
                                file=sys.stderr,
                            )
                # Fairness: one lore job per speak job when lore backlog exists (ISSUE-030)
                drain_one_lore_job(r, client, settings)
                drain_one_ambient_intent_job(r, client, settings)
                drain_one_world_vote_job(r, client, settings)
                continue
            if queue == "lore":
                try:
                    process_lore_job(client, settings, payload)
                except Exception as exc:
                    print(f"lore job error jobId={payload.get('jobId')}: {exc}", file=sys.stderr)
                continue
            try:
                process_ambient_intent_job(client, settings, payload)
            except Exception as exc:
                print(f"ambient intent job error jobId={payload.get('jobId')}: {exc}", file=sys.stderr)
            drain_one_world_vote_job(r, client, settings)


def main() -> None:
    settings = get_settings()
    if os.getenv("LLM_MOCK") == "1" and not settings.redis_url:
        run_mock()
        return
    run_worker()


if __name__ == "__main__":
    main()
