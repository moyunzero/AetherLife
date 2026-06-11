import json
import os
import sys
import threading
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
from src.graph.speak_intent import can_use_casual_fast_lane
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

BRIDGE_LIST_KEY = "aetherlife:npc-turn:jobs"
LORE_BRIDGE_LIST_KEY = "aetherlife:chunk-lore:jobs"
AMBIENT_INTENT_BRIDGE_LIST_KEY = "aetherlife:npc-ambient-intent:jobs"
BLPOP_TIMEOUT_S = 5
LORE_BLPOP_TIMEOUT_S = 1
AMBIENT_BLPOP_TIMEOUT_S = 1


def create_redis_client(redis_url: str) -> redis.Redis:
    """
    Create and validate a Redis client configured for long-running blocking operations.
    
    Parameters:
        redis_url (str): Redis connection URL (e.g., from Upstash or REDIS_URL).
    
    Returns:
        redis.Redis: A connected Redis client configured with response decoding enabled, no socket timeout (suitable for blocking pops), retry-on-timeout, and periodic health checks.
    """
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


def process_lore_job(client: httpx.Client, settings: Settings, payload: dict) -> None:
    """
    Handle a single chunk-lore job payload by running the lore processing pipeline.
    
    This function records receipt of the job to stderr and invokes the lore job runner with the provided HTTP client and settings.
    
    Parameters:
        client (httpx.Client): HTTP client used by the lore pipeline for outbound requests.
        settings (Settings): Application settings and configuration used by the pipeline.
        payload (dict): Job payload containing at least `jobId` and chunk coordinates `cx`, `cy`; may include other job-specific fields consumed by the lore runner.
    """
    print(
        f"lore job received jobId={payload.get('jobId')} chunk=({payload.get('cx')},{payload.get('cy')})",
        file=sys.stderr,
    )
    run_lore_job(payload, settings=settings, client=client)


def process_ambient_intent_job(client: httpx.Client, settings: Settings, payload: dict) -> None:
    """
    Process a single ambient-intent job payload by invoking the ambient intent pipeline.
    
    Logs receipt of the job (including `jobId` and `npcId` when present) and calls the ambient intent worker to handle the provided payload.
    
    Parameters:
        payload (dict): Job payload expected to include keys such as `jobId` and `npcId`; additional fields required by the ambient intent pipeline may also be present.
    """
    print(
        f"ambient intent job received jobId={payload.get('jobId')} npc={payload.get('npcId')}",
        file=sys.stderr,
    )
    run_ambient_intent_job(payload, settings=settings, client=client)


def drain_one_ambient_intent_job(r: redis.Redis, client: httpx.Client, settings: Settings) -> bool:
    """
    Attempt to remove and process a single ambient-intent job from the Redis queue.
    
    Performs a non-blocking pop from the ambient-intent bridge list; if an item is found it is parsed as JSON and passed to the ambient-intent job processor. Exceptions raised during processing are caught and logged to stderr.
    
    Returns:
        true if a job was removed from the queue and handed to the processor, false otherwise.
    """
    raw = r.rpop(AMBIENT_INTENT_BRIDGE_LIST_KEY)
    if not raw:
        return False
    payload = json.loads(raw)
    try:
        process_ambient_intent_job(client, settings, payload)
    except Exception as exc:
        print(f"ambient intent job error jobId={payload.get('jobId')}: {exc}", file=sys.stderr)
    return True


def drain_one_lore_job(r: redis.Redis, client: httpx.Client, settings: Settings) -> bool:
    """
    Attempt to process a single pending chunk-lore job from the lore queue without blocking.
    
    Attempts a non-blocking pop from the lore queue and, if an item is found, parses and processes it; exceptions during processing are caught and logged.
    
    Returns:
        `True` if a job was popped and processing was attempted, `False` if the queue was empty.
    """
    # game-server LPUSH → RPOP oldest first (FIFO), same as main-loop BRPOP
    raw = r.rpop(LORE_BRIDGE_LIST_KEY)
    if not raw:
        return False
    payload = json.loads(raw)
    try:
        process_lore_job(client, settings, payload)
    except Exception as exc:
        print(f"lore job error jobId={payload.get('jobId')}: {exc}", file=sys.stderr)
    return True


def process_job(client: httpx.Client, settings: Settings, payload: dict) -> None:
    """
    Handle a single NPC "speak" job: run the appropriate LLM pipeline, emit progress and final events to the game server, and start asynchronous memory tailing.
    
    This function:
    - Emits an initial "thinking" event and sends incremental "speakPartial" events via a job-scoped partial_emit callback.
    - Establishes job context and an LLM call recorder for phase timing and summarization.
    - Selects between a casual fast-preview pipeline and the interactive NPC-turn pipeline, runs the chosen pipeline, and resets job context afterward.
    - Audits the produced reply, assembles a final "done" payload (including optional fields such as `speakIntent`, `phaseTimingMs`, `gateRejected`/`gateKind`, `collectiveUpdated`, `memoryQuote`, and `llmCallSummary`), and emits the "done" event.
    - Launches a background daemon thread to run memory tailing and, if applicable, log a full LLM call summary.
    
    Parameters:
        client (httpx.Client): HTTP client used to send job events to the game server.
        settings (Settings): Runtime settings/configuration used by pipelines and event emission.
        payload (dict): Job payload containing at least the key `jobId`. Recognized optional keys:
            - roomId (str): Room identifier (defaults to "default").
            - npcId (str): NPC identifier (defaults to "npc-1").
            - playerMessage (str): The player's message that triggered the job.
            - playerId (str): Player identifier (defaults to "__legacy__").
            - recentTurns (list): Recent conversational turns for context.
            - casualPreviewEmitted (bool): If true, suppresses emitting a casual preview stub.
    """
    job_id = payload["jobId"]
    room_id = payload.get("roomId", "default")
    npc_id = payload.get("npcId", "npc-1")
    player_message = payload.get("playerMessage", "")
    player_id = payload.get("playerId", "__legacy__")
    recent_turns = payload.get("recentTurns") or []

    emit_job_event(client, settings, job_id, "thinking", {"status": "planning", "npcId": npc_id})

    phase_timing: dict[str, int] = {}

    def partial_emit(text: str) -> None:
        """
        Emit a "speakPartial" job event carrying a text fragment for the current NPC.
        
        Parameters:
            text (str): Fragment of speech to emit; included in the event payload as "text" alongside the current NPC's id.
        """
        emit_job_event(
            client,
            settings,
            job_id,
            "speakPartial",
            {"text": text, "npcId": npc_id},
        )

    ctx_tokens = set_job_context(partial_emit=partial_emit, phase_timing=phase_timing)
    start_recorder()
    try:
        recent = recent_turns if isinstance(recent_turns, list) else []
        preview_already_emitted = bool(payload.get("casualPreviewEmitted"))
        _intent, fast_preview = can_use_casual_fast_lane(player_message, recent)
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
    if phase_timing:
        done_payload["phaseTimingMs"] = phase_timing
    if result.get("gate_rejected"):
        done_payload["gateRejected"] = True
        gate_kind = result.get("gate_kind")
        if isinstance(gate_kind, str) and gate_kind.strip():
            done_payload["gateKind"] = gate_kind.strip()
    if result.get("collective_updated"):
        done_payload["collectiveUpdated"] = True

    memory_quote = pick_memory_quote(
        result.get("retrieved_memories"),
        int(result.get("memory_count") or 0),
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
        try:
            run_npc_memory_tail(result, settings)
            tail_recorder = get_recorder()
            if tail_recorder is not None and tail_recorder.total > 0:
                print(
                    f"llmCallSummary jobId={job_id} full={summarize_for_log(tail_recorder)}",
                    file=sys.stderr,
                )
        except Exception as exc:
            print(
                f"memory tail failed jobId={job_id} (player already got done): {exc}",
                file=sys.stderr,
            )

    threading.Thread(target=_memory_tail_worker, daemon=True).start()


def run_mock() -> None:
    print(json.dumps({"reply": "（模拟）我听到了你的话。", "toolCalls": []}, ensure_ascii=False))


def run_worker() -> None:
    """
    Start and run the agent worker loop that pulls jobs from Redis and dispatches them.
    
    Initializes settings, optional LangSmith and database environment, validates LLM configuration, sets up the checkpointer, connects to Redis (clearing stale npc-turn jobs on startup), and enters an infinite loop that blocks for jobs and processes them. Queue polling order prioritizes npc-turn jobs, then chunk-lore, then ambient-intent; each queue item is parsed as JSON and dispatched to the appropriate handler. For npc-turn jobs the worker emits status events, handles errors by emitting an "error" job event, and performs fairness draining of one lore and one ambient-intent job after each npc job. Connection and configuration failures cause the process to exit or recreate connections as appropriate.
    
    Returns:
        None
    """
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

    with httpx.Client() as client:
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
                continue
            _, raw = item
            payload = json.loads(raw)
            if queue == "npc":
                print(f"job received jobId={payload.get('jobId')}", file=sys.stderr)
                try:
                    process_job(client, settings, payload)
                except Exception as exc:
                    print(f"job failed jobId={payload.get('jobId')}: {exc}", file=sys.stderr)
                    err_msg = format_llm_error(exc, provider=settings.llm_provider)
                    emit_job_event(
                        client,
                        settings,
                        payload["jobId"],
                        "error",
                        {"message": err_msg},
                    )
                # Fairness: one lore job per speak job when lore backlog exists (ISSUE-030)
                drain_one_lore_job(r, client, settings)
                drain_one_ambient_intent_job(r, client, settings)
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


def main() -> None:
    """
    Entry point that starts the appropriate worker mode based on environment and settings.
    
    If the environment variable `LLM_MOCK` equals "1" and no Redis URL is configured, runs the mock worker and returns; otherwise starts the full worker loop.
    """
    settings = get_settings()
    if os.getenv("LLM_MOCK") == "1" and not settings.redis_url:
        run_mock()
        return
    run_worker()


if __name__ == "__main__":
    main()
