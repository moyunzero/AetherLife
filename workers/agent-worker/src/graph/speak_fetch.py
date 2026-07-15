"""Speak pre-LLM fetch: memory RAG, dual-RAG enrichment, parallel orchestration."""

from __future__ import annotations

import sys
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import httpx

from src.collective.scoring import allowed_tools_for_band
from src.config import Settings
from src.council.memory_context import fetch_dual_rag_context
from src.graph.job_context import record_phase_ms
from src.graph.prompt import format_memory_summary
from src.graph.recall_merge import (
    augment_retrieved_with_dialogue_turns,
    augment_retrieved_with_recent,
    is_recall_question,
    needs_recency_augment,
    pick_recall_memory,
)
from src.graph.speak_intent import (
    SpeakIntent,
    classify_speak_intent,
    message_needs_nearby_lore,
    should_skip_memory_context,
    should_skip_memory_embed,
)
from src.graph.state import GraphState
from src.graph.worker_state_fetch import (
    _FETCH_STATE_TIMEOUT_S,
    _game_headers,
    _player_id,
    fetch_state,
)
from src.http_json import create_http_client, safe_response_json
from src.memory.client import (
    _MEMORY_CONTEXT_INTERACTIVE_TIMEOUT_S,
    _MEMORY_CONTEXT_RECALL_ATTEMPTS,
    _MEMORY_CONTEXT_RECALL_TIMEOUT_S,
    fetch_memory_context,
    fetch_recent_memories,
    parse_collective_from_context,
)

_RUNTIME_REL_TIMEOUT_S = 6.0

_MEMORY_MERGE_KEYS = (
    "memory_summary",
    "memory_count",
    "retrieved_memories",
    "latest_bulk",
    "latest_reflection",
    "gate_rejected",
    "attitude_band",
    "effective_score",
    "allowed_tools",
    "collective_summaries",
)


def _neutral_memory_fields() -> dict[str, Any]:
    band = "neutral"
    return {
        "memory_summary": "",
        "memory_count": 0,
        "retrieved_memories": [],
        "latest_bulk": None,
        "latest_reflection": None,
        "gate_rejected": False,
        "attitude_band": band,
        "effective_score": None,
        "allowed_tools": list(allowed_tools_for_band(band)),
        "collective_summaries": [],
        "runtime_relationships": [],
        "canon_context": "",
    }


def fetch_runtime_relationship_edges(
    state: GraphState,
    *,
    settings: Settings,
    client: httpx.Client,
) -> list[dict[str, Any]]:
    room_id = state["room_id"]
    npc_id = state.get("npc_id") or "npc-1"
    url = f"{settings.game_server_url}/internal/rooms/{room_id}/npc-relationships"
    try:
        res = client.get(
            url,
            params={"npcId": npc_id, "limit": "5"},
            headers=_game_headers(settings),
            timeout=_RUNTIME_REL_TIMEOUT_S,
        )
        res.raise_for_status()
        return list(safe_response_json(res).get("edges") or [])
    except Exception as exc:
        print(
            f"npc-relationships fetch failed room={room_id} npc={npc_id}: {exc}",
            file=sys.stderr,
        )
        return []


def _fetch_speak_enrichment(
    state: GraphState,
    *,
    settings: Settings,
    client: httpx.Client,
    skip_dual_rag: bool,
) -> dict[str, Any]:
    npc_id = state.get("npc_id") or "npc-1"
    edges: list[dict[str, Any]] = []
    canon_context = ""
    if not skip_dual_rag:
        edges = fetch_runtime_relationship_edges(state, settings=settings, client=client)
        speak_intent = state.get("speak_intent")
        if speak_intent:
            intent = SpeakIntent(speak_intent)
        else:
            intent = classify_speak_intent(
                state.get("player_message") or "",
                state.get("recent_turns"),
            )
        dual = fetch_dual_rag_context(
            client,
            settings,
            state["room_id"],
            state.get("player_message") or "",
            npc_id=npc_id,
            skip_embed=should_skip_memory_embed(intent),
        )
        canon_context = str(dual.get("canon_context") or "")
    return {
        "runtime_relationships": edges,
        "canon_context": canon_context,
    }


def _load_collective_gate_fields(
    state: GraphState,
    *,
    settings: Settings,
    client: httpx.Client,
) -> dict[str, Any]:
    """Hostile gate needs band/allowed_tools even when full memory-context is skipped."""
    try:
        ctx = fetch_memory_context(
            client,
            settings,
            state["room_id"],
            (state.get("player_message") or "").strip() or " ",
            npc_id=state.get("npc_id") or "npc-1",
            player_id=_player_id(state),
            timeout=_MEMORY_CONTEXT_INTERACTIVE_TIMEOUT_S,
            attempts=1,
            skip_embed=True,
        )
    except Exception as exc:
        print(
            f"collective gate load failed room={state['room_id']}: {exc}",
            file=sys.stderr,
        )
        return {}
    parsed = parse_collective_from_context(ctx)
    return {
        key: parsed[key]
        for key in (
            "attitude_band",
            "effective_score",
            "allowed_tools",
            "collective_summaries",
        )
        if key in parsed
    }


def fetch_nearby_lore_into_snapshot(
    state: GraphState,
    *,
    settings: Settings,
    client: httpx.Client,
) -> GraphState:
    """Lazy lore: full worker-state without skipNearbyLore (NARRATIVE + lore markers only)."""
    room_id = state["room_id"]
    headers = _game_headers(settings)
    player_id = _player_id(state)
    if player_id and player_id != "__legacy__":
        headers["X-Player-Id"] = player_id
    url = f"{settings.game_server_url}/internal/rooms/{room_id}/worker-state"
    try:
        res = client.get(url, headers=headers, timeout=_FETCH_STATE_TIMEOUT_S)
        res.raise_for_status()
        nearby = safe_response_json(res).get("nearbyLore") or []
        snapshot = {**(state.get("room_snapshot") or {}), "nearbyLore": nearby}
        return {**state, "room_snapshot": snapshot}
    except Exception as exc:
        print(f"lazy nearby-lore failed room={room_id}: {exc}", file=sys.stderr)
        return state


def load_memory_context(
    state: GraphState,
    *,
    settings: Settings,
    client: httpx.Client,
    memory_timeout: float | None = None,
    memory_attempts: int = 3,
    skip_embed: bool = False,
) -> GraphState:
    npc_id = state.get("npc_id") or "npc-1"
    try:
        ctx = fetch_memory_context(
            client,
            settings,
            state["room_id"],
            state.get("player_message") or "",
            npc_id=npc_id,
            player_id=_player_id(state),
            timeout=memory_timeout,
            attempts=memory_attempts,
            skip_embed=skip_embed,
        )
    except httpx.TimeoutException as exc:
        print(
            f"memory-context timeout room={state['room_id']} npc={npc_id}: {exc}",
            file=sys.stderr,
        )
        ctx = {}
    except httpx.HTTPError as exc:
        print(
            f"memory-context http error room={state['room_id']} npc={npc_id}: {exc}",
            file=sys.stderr,
        )
        ctx = {}
    player_msg = (state.get("player_message") or "").strip()
    recall_recent_limit = 30 if ("密码" in player_msg and is_recall_question(player_msg)) else 20
    if needs_recency_augment(player_msg) and not skip_embed:
        try:
            recent = fetch_recent_memories(
                client,
                settings,
                state["room_id"],
                limit=recall_recent_limit,
                npc_id=npc_id,
                player_id=_player_id(state),
            )
            augmented = augment_retrieved_with_recent(
                ctx.get("retrieved"),
                recent,
            )
            augmented = augment_retrieved_with_dialogue_turns(
                augmented,
                state.get("recent_turns"),
            )
            if augmented:
                ctx = {
                    **ctx,
                    "retrieved": augmented,
                    "memoryCount": max(
                        int(ctx.get("memoryCount") or 0),
                        len(augmented),
                    ),
                }
                print(
                    f"memory-context recall recency-augment room={state['room_id']} "
                    f"npc={npc_id} rows={len(augmented)} recent={len(recent)}",
                    file=sys.stderr,
                )
        except Exception as exc:
            print(
                f"memory-context recall recency-augment failed room={state['room_id']}: {exc}",
                file=sys.stderr,
            )

    if is_recall_question(player_msg) and not pick_recall_memory(
        player_msg,
        ctx.get("retrieved"),
    ):
        try:
            recent = fetch_recent_memories(
                client,
                settings,
                state["room_id"],
                limit=recall_recent_limit,
                npc_id=npc_id,
                player_id=_player_id(state),
            )
            if recent:
                fallback = augment_retrieved_with_recent([], recent)
                fallback = augment_retrieved_with_dialogue_turns(
                    fallback,
                    state.get("recent_turns"),
                )
                if pick_recall_memory(player_msg, fallback):
                    ctx = {
                        **ctx,
                        "retrieved": fallback,
                        "memoryCount": max(
                            int(ctx.get("memoryCount") or 0),
                            len(fallback),
                        ),
                    }
                    print(
                        f"memory-context recall recent-only fallback room={state['room_id']} "
                        f"npc={npc_id} player={_player_id(state)} rows={len(fallback)}",
                        file=sys.stderr,
                    )
                else:
                    preview = (recent[0].get("text") or "")[:80] if recent else ""
                    print(
                        f"memory-context recall recent-only miss room={state['room_id']} "
                        f"npc={npc_id} player={_player_id(state)} recent={len(recent)} "
                        f"preview={preview!r}",
                        file=sys.stderr,
                    )
        except Exception as exc:
            print(
                f"memory-context recall recent-only fallback failed "
                f"room={state['room_id']}: {exc}",
                file=sys.stderr,
            )
    summary = format_memory_summary(
        latest_bulk=ctx.get("latestBulkSummary"),
        latest_reflection=ctx.get("latestReflection"),
        retrieved=ctx.get("retrieved"),
    )
    collective = parse_collective_from_context(ctx)
    return {
        **state,
        "memory_summary": summary,
        "memory_count": int(ctx.get("memoryCount") or 0),
        "retrieved_memories": ctx.get("retrieved") or [],
        "latest_bulk": ctx.get("latestBulkSummary"),
        "latest_reflection": ctx.get("latestReflection"),
        "gate_rejected": False,
        **collective,
    }


def _attach_speak_enrichment(
    state: GraphState,
    *,
    settings: Settings,
    skip_dual_rag: bool,
) -> GraphState:
    t0 = time.perf_counter()
    with create_http_client() as thread_client:
        enrichment = _fetch_speak_enrichment(
            state,
            settings=settings,
            client=thread_client,
            skip_dual_rag=skip_dual_rag,
        )
    record_phase_ms("t_speak_enrichment_ms", int((time.perf_counter() - t0) * 1000))
    return {**state, **enrichment}


def fetch_state_and_memory(
    state: GraphState,
    *,
    settings: Settings,
    client: httpx.Client,
) -> GraphState:
    """Parallel worker-state + memory-context to cut speak pre-LLM latency."""
    del client  # each thread uses its own httpx.Client (not thread-safe)
    player_message = state.get("player_message") or ""
    recent_turns = state.get("recent_turns")
    intent = classify_speak_intent(player_message, recent_turns)
    state = {**state, "speak_intent": intent.value}
    skip_memory = should_skip_memory_context(intent)
    skip_embed = should_skip_memory_embed(intent)

    if skip_memory:
        t0 = time.perf_counter()
        with create_http_client() as thread_client:
            state_with_room = fetch_state(
                state,
                settings=settings,
                client=thread_client,
                skip_nearby_lore=True,
            )
        record_phase_ms("t_fetch_state_ms", int((time.perf_counter() - t0) * 1000))
        merged = {**state_with_room, **_neutral_memory_fields()}
        if intent == SpeakIntent.PHYSICAL:
            t_mem = time.perf_counter()
            with create_http_client() as thread_client:
                merged.update(
                    _load_collective_gate_fields(
                        merged,
                        settings=settings,
                        client=thread_client,
                    ),
                )
            record_phase_ms("t_memory_ms", int((time.perf_counter() - t_mem) * 1000))
        else:
            record_phase_ms("t_memory_ms", 0)
        merged["speak_intent"] = intent.value
        return _attach_speak_enrichment(
            merged,
            settings=settings,
            skip_dual_rag=True,
        )

    def _fetch() -> GraphState:
        t0 = time.perf_counter()
        with create_http_client() as thread_client:
            out = fetch_state(
                state,
                settings=settings,
                client=thread_client,
                skip_nearby_lore=True,
            )
        record_phase_ms("t_fetch_state_ms", int((time.perf_counter() - t0) * 1000))
        return out

    def _memory() -> GraphState:
        t0 = time.perf_counter()
        recall = intent == SpeakIntent.RECALL
        memory_timeout = (
            _MEMORY_CONTEXT_RECALL_TIMEOUT_S if recall else _MEMORY_CONTEXT_INTERACTIVE_TIMEOUT_S
        )
        memory_attempts = _MEMORY_CONTEXT_RECALL_ATTEMPTS if recall else 1
        with create_http_client() as thread_client:
            out = load_memory_context(
                state,
                settings=settings,
                client=thread_client,
                memory_timeout=memory_timeout,
                memory_attempts=memory_attempts,
                skip_embed=skip_embed,
            )
        record_phase_ms("t_memory_ms", int((time.perf_counter() - t0) * 1000))
        return out

    with ThreadPoolExecutor(max_workers=2) as pool:
        state_future = pool.submit(_fetch)
        memory_future = pool.submit(_memory)
        state_with_room = state_future.result()
        state_with_memory = memory_future.result()

    merged = {**state_with_room}
    for key in _MEMORY_MERGE_KEYS:
        if key in state_with_memory:
            merged[key] = state_with_memory[key]
    merged["speak_intent"] = intent.value

    if intent == SpeakIntent.NARRATIVE and message_needs_nearby_lore(player_message):
        t0 = time.perf_counter()
        with create_http_client() as thread_client:
            merged = fetch_nearby_lore_into_snapshot(
                merged,
                settings=settings,
                client=thread_client,
            )
        record_phase_ms("t_lazy_lore_ms", int((time.perf_counter() - t0) * 1000))

    return _attach_speak_enrichment(
        merged,
        settings=settings,
        skip_dual_rag=False,
    )
