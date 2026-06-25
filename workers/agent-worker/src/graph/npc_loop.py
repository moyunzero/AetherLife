import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import httpx
from langchain_core.messages import HumanMessage
from langgraph.graph import END, StateGraph

from src.config import Settings, get_settings
from src.graph.action_intent import (
    build_dialogue_context,
    build_tool_retry_message,
    has_state_changing_tool,
    inject_relative_move_tool,
    player_requests_interact,
    player_requests_move,
    player_requests_physical_action,
    resolve_npc_snap_anchor_cell,
)
from src.graph.action_sanitize import tool_calls_to_actions
from src.graph.prompt import build_turn_messages, format_memory_summary
from src.graph.reflect import run_reflect_llm, should_reflect
from src.graph.state import GraphState
from src.graph.summarize import maybe_bulk_summarize
from src.graph.recall_merge import (
    augment_retrieved_with_dialogue_turns,
    augment_retrieved_with_recent,
    is_recall_question,
    merge_recall_into_reply,
    needs_recency_augment,
    pick_recall_memory,
)
from src.graph.reply_sanitize import sanitize_npc_reply
from src.graph.tools import load_tools_for_binding, parse_tool_calls, reply_from_turn
from src.http_json import create_http_client, safe_response_json
from src.llm.errors import (
    LlmCallError,
    is_auth_error,
    is_rate_limit_error,
    is_retryable_llm_error,
    retry_after_seconds,
)
from src.llm.factory import create_chat_model, npc_provider_attempts
from src.llm.openrouter_keys import openrouter_keys
from src.collective.constants import ALL_ALLOWED_TOOLS
from src.collective.scoring import allowed_tools_for_band
from src.collective.refine import maybe_collective_refine
from src.collective.schemas import SocialPerception
from src.collective.social_turn import (
    apply_social_from_llm,
    npc_positions_from_room,
    reconcile_social_perception,
    refresh_collective_snapshot,
)
from src.graph.nodes.llm_social_turn import llm_social_turn
from src.graph.job_context import get_partial_emit, record_phase_ms
from src.graph.speak_intent import (
    SpeakIntent,
    classify_speak_intent,
    message_needs_nearby_lore,
    should_skip_memory_context,
    should_skip_memory_embed,
)
from src.llm.call_budget import record_llm_call
from src.council.memory_context import fetch_dual_rag_context
from src.memory.client import (
    _MEMORY_CONTEXT_INTERACTIVE_TIMEOUT_S,
    _MEMORY_CONTEXT_RECALL_ATTEMPTS,
    _MEMORY_CONTEXT_RECALL_TIMEOUT_S,
    append_npc_memory,
    append_player_memory,
    fetch_memory_context,
    fetch_recent_memories,
    parse_collective_from_context,
    store_reflection,
)
from src.memory.importance import DEFAULT_IMPORTANCE, score_importance, score_turn_importance
from src.persistence.checkpointer import get_checkpointer


def _mock_tool_calls() -> list[dict[str, Any]]:
    # Avoid door cell (3,3) — executor treats objects as blocked.
    return [{"name": "move", "args": {"type": "move", "x": 4, "y": 5}}]


def _game_headers(settings: Settings) -> dict[str, str]:
    headers: dict[str, str] = {}
    if settings.internal_worker_token:
        headers["Authorization"] = f"Bearer {settings.internal_worker_token}"
    return headers


_FETCH_STATE_TIMEOUT_S = 6.0
_FETCH_STATE_ATTEMPTS = 2
_FETCH_STATE_HOT_CACHE_TTL_S = 3.0
_STALE_SNAPSHOT_TTL_S = 300.0
_RUNTIME_REL_TIMEOUT_S = 6.0
_stale_worker_snapshots: dict[str, tuple[dict[str, Any], float]] = {}


def _worker_state_stale_key(room_id: str, player_id: str) -> str:
    return f"{room_id}:{player_id}"


def _remember_worker_snapshot(room_id: str, player_id: str, snapshot: dict[str, Any]) -> None:
    clean = {k: v for k, v in snapshot.items() if not str(k).startswith("_")}
    _stale_worker_snapshots[_worker_state_stale_key(room_id, player_id)] = (
        clean,
        time.time(),
    )


def _stale_worker_snapshot(room_id: str, player_id: str) -> dict[str, Any] | None:
    entry = _stale_worker_snapshots.get(_worker_state_stale_key(room_id, player_id))
    if not entry:
        return None
    snap, ts = entry
    if time.time() - ts > _STALE_SNAPSHOT_TTL_S:
        return None
    age_ms = int((time.time() - ts) * 1000)
    return {**snap, "_stale": True, "_stale_age_ms": age_ms}


def _hot_worker_snapshot(room_id: str, player_id: str) -> dict[str, Any] | None:
    """Fresh worker-state snapshot within hot TTL — skip HTTP on back-to-back speaks."""
    entry = _stale_worker_snapshots.get(_worker_state_stale_key(room_id, player_id))
    if not entry:
        return None
    snap, ts = entry
    age_s = time.time() - ts
    if age_s > _FETCH_STATE_HOT_CACHE_TTL_S:
        return None
    age_ms = int(age_s * 1000)
    return {**snap, "_cache_hit": True, "_cache_age_ms": age_ms}


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
    edges = fetch_runtime_relationship_edges(state, settings=settings, client=client)
    canon_context = ""
    if not skip_dual_rag:
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


def fetch_state(
    state: GraphState,
    *,
    settings: Settings,
    client: httpx.Client,
    skip_nearby_lore: bool = False,
) -> GraphState:
    room_id = state["room_id"]
    headers = _game_headers(settings)
    player_id = _player_id(state)
    if player_id and player_id != "__legacy__":
        headers["X-Player-Id"] = player_id
    url = f"{settings.game_server_url}/internal/rooms/{room_id}/worker-state"
    if skip_nearby_lore:
        url = f"{url}?skipNearbyLore=1"
    hot = _hot_worker_snapshot(room_id, player_id)
    if hot is not None:
        age_ms = int(hot.pop("_cache_age_ms", 0))
        hot.pop("_cache_hit", None)
        record_phase_ms("t_fetch_state_ms", 0)
        record_phase_ms("t_fetch_state_cache_age_ms", age_ms)
        return {**state, "room_snapshot": hot}
    last_exc: BaseException | None = None
    for attempt in range(_FETCH_STATE_ATTEMPTS):
        try:
            res = client.get(url, headers=headers, timeout=_FETCH_STATE_TIMEOUT_S)
            res.raise_for_status()
            body = safe_response_json(res)
            snapshot = body.get("state", {}) or {}
            nearby = body.get("nearbyLore")
            if nearby is not None:
                snapshot = {**snapshot, "nearbyLore": nearby}
            _remember_worker_snapshot(room_id, player_id, snapshot)
            return {**state, "room_snapshot": snapshot}
        except httpx.TimeoutException as exc:
            last_exc = exc
            print(
                f"worker-state timeout room={room_id} attempt={attempt + 1}/{_FETCH_STATE_ATTEMPTS}",
                file=sys.stderr,
            )
            if attempt + 1 < _FETCH_STATE_ATTEMPTS:
                time.sleep(0.5 + attempt)
                continue
            stale = _stale_worker_snapshot(room_id, player_id)
            if stale is not None:
                age_ms = int(stale.get("_stale_age_ms") or 0)
                print(
                    f"worker-state stale-fallback room={room_id} age_ms={age_ms}",
                    file=sys.stderr,
                )
                record_phase_ms("t_worker_state_stale_ms", age_ms)
                return {**state, "room_snapshot": stale}
            raise
    if last_exc is not None:
        raise last_exc
    raise RuntimeError("fetch_state retry loop exited without response")


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



def _player_id(state: GraphState) -> str:
    return state.get("player_id") or "__legacy__"


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


def _invoke_llm_turn(
    llm: Any,
    messages: list[Any],
    *,
    player_message: str,
    room_snapshot: dict[str, Any],
    provider: str,
    model: str,
) -> tuple[list[dict[str, Any]], str]:
    from src.llm.invoke_tools import invoke_tool_bound_llm

    response = invoke_tool_bound_llm(llm, messages)
    record_llm_call("main", provider, model)
    tool_calls = parse_tool_calls(response)
    reply = reply_from_turn(response, tool_calls)

    needs_action = player_requests_physical_action(player_message)
    if needs_action and not has_state_changing_tool(tool_calls):
        retry_messages = [
            *messages,
            HumanMessage(content=build_tool_retry_message(room_snapshot)),
        ]
        response = invoke_tool_bound_llm(llm, retry_messages)
        record_llm_call("main", provider, model)
        tool_calls = parse_tool_calls(response)
        reply = reply_from_turn(response, tool_calls)

    tool_calls = inject_relative_move_tool(
        tool_calls,
        player_message=player_message,
        room=room_snapshot,
    )
    return tool_calls, reply


def _allowed_tool_names(state: GraphState) -> set[str]:
    allowed = state.get("allowed_tools")
    if allowed:
        return set(allowed)
    return set(ALL_ALLOWED_TOOLS)


def _filter_tool_calls(
    tool_calls: list[dict[str, Any]],
    allowed: set[str],
) -> tuple[list[dict[str, Any]], bool]:
    filtered = [call for call in tool_calls if call.get("name") in allowed]
    return filtered, len(filtered) < len(tool_calls)


def llm_turn(state: GraphState, *, settings: Settings) -> GraphState:
    allowed = _allowed_tool_names(state)
    if settings.llm_mock or os.getenv("LLM_MOCK") == "1":
        msg = (state.get("player_message") or "").strip()
        mock_reply = f"（模拟）我听到了：{msg[:120]}" if msg else "（模拟）我听到了你的话。"
        room_snapshot = state.get("room_snapshot") or {}
        tool_calls = inject_relative_move_tool(
            _mock_tool_calls(),
            player_message=msg,
            room=room_snapshot,
        )
        tool_calls, gate_rejected = _filter_tool_calls(tool_calls, allowed)
        return {
            **state,
            "tool_calls": tool_calls,
            "reply": mock_reply,
            "gate_rejected": gate_rejected,
        }

    messages = build_turn_messages(state)
    tools = [
        tool
        for tool in load_tools_for_binding()
        if tool["function"]["name"] in allowed
    ]
    player_message = state.get("player_message") or ""
    room_snapshot = state.get("room_snapshot") or {}
    last_error: BaseException | None = None
    last_provider: str = settings.llm_provider.lower()
    last_model: str | None = settings.llm_model

    for provider, model in npc_provider_attempts(settings):
        last_provider = provider
        last_model = model
        use_openrouter = provider == "openrouter"
        key_candidates: list[str | None] = openrouter_keys(settings) if use_openrouter else [None]
        if use_openrouter and not key_candidates:
            key_candidates = [None]

        for key_idx, or_key in enumerate(key_candidates):
            llm = create_chat_model(
                settings=settings,
                provider=provider,
                model=model,
                api_key=or_key,
            ).bind_tools(tools)
            for attempt in range(3):
                try:
                    tool_calls, reply = _invoke_llm_turn(
                        llm,
                        messages,
                        player_message=player_message,
                        room_snapshot=room_snapshot,
                        provider=provider,
                        model=model,
                    )
                    return {**state, "tool_calls": tool_calls, "reply": reply}
                except Exception as exc:
                    last_error = exc
                    if is_auth_error(exc):
                        raise
                    if is_rate_limit_error(exc):
                        if use_openrouter and key_idx + 1 < len(key_candidates):
                            print(
                                f"LLM OpenRouter key #{key_idx + 1} rate-limited, trying next key",
                                file=sys.stderr,
                            )
                            break
                        if attempt < 2:
                            time.sleep(retry_after_seconds(exc))
                            continue
                    if is_retryable_llm_error(exc):
                        print(
                            f"LLM fallback provider={provider} model={model} error={type(exc).__name__}",
                            file=sys.stderr,
                        )
                        break
                    raise
            if last_error and is_rate_limit_error(last_error) and key_idx + 1 < len(key_candidates):
                continue
            if last_error and is_retryable_llm_error(last_error):
                break
            if last_error:
                raise last_error

    assert last_error is not None
    raise LlmCallError(last_error, provider=last_provider, model=last_model) from last_error


def apply_tools(state: GraphState, *, settings: Settings, client: httpx.Client) -> GraphState:
    t0 = time.perf_counter()
    room = state.get("room_snapshot") or {}
    allowed = _allowed_tool_names(state)
    player_msg = state.get("player_message") or ""
    dialogue_ctx = build_dialogue_context(player_msg, state.get("recent_turns"))
    raw_calls = list(state.get("tool_calls") or [])
    physical = player_requests_physical_action(player_msg)
    if physical:
        raw_calls = inject_relative_move_tool(
            raw_calls,
            player_message=player_msg,
            room=room,
            dialogue_context=dialogue_ctx,
        )
    tool_calls, stripped = _filter_tool_calls(raw_calls, allowed)
    gate_rejected = bool(state.get("gate_rejected")) or stripped
    state = {**state, "tool_calls": tool_calls, "gate_rejected": gate_rejected}
    actions = tool_calls_to_actions(tool_calls, room=room)

    if not actions:
        record_phase_ms("t_apply_ms", int((time.perf_counter() - t0) * 1000))
        return state

    room_id = state["room_id"]
    npc_id = state.get("npc_id") or "npc-1"
    body: dict[str, Any] = {"actions": actions, "actingNpcId": npc_id}
    player_id = _player_id(state)
    headers = _game_headers(settings)
    if player_id and player_id != "__legacy__":
        headers["X-Player-Id"] = player_id
        body["initiatorPlayerId"] = player_id
    snap_anchor = resolve_npc_snap_anchor_cell(player_msg, room, dialogue_ctx)
    if snap_anchor is not None:
        body["moveSnapAnchor"] = {"x": snap_anchor[0], "y": snap_anchor[1]}
    res = client.post(
        f"{settings.game_server_url}/internal/rooms/{room_id}/apply-actions",
        json=body,
        headers=headers,
        timeout=20.0,
    )
    if res.status_code >= 400:
        detail = res.text.strip()
        payload = safe_response_json(res)
        if res.status_code == 403 and payload.get("code") == "hostile_gate":
            action_type = payload.get("actionType")
            record_phase_ms("t_apply_ms", int((time.perf_counter() - t0) * 1000))
            out: GraphState = {
                **state,
                "gate_rejected": True,
                "tool_calls": [],
                "pending_actions": [],
            }
            if isinstance(action_type, str) and action_type.strip():
                out["gate_kind"] = action_type.strip()
            return out
        raise RuntimeError(
            f"apply-actions failed ({res.status_code}): {detail[:500]}",
        )
    body = safe_response_json(res)
    updated_snapshot = body.get("state")
    if not isinstance(updated_snapshot, dict):
        updated_snapshot = state.get("room_snapshot") or {}
    _remember_worker_snapshot(room_id, player_id, updated_snapshot)
    record_phase_ms("t_apply_ms", int((time.perf_counter() - t0) * 1000))
    return {
        **state,
        "room_snapshot": updated_snapshot,
        "pending_actions": actions,
    }


def _finalize_hostile_gate(state: GraphState) -> GraphState:
    """Hostile band: physical intent without move/interact in applied tools counts as gate."""
    if (state.get("attitude_band") or "") != "hostile":
        return state
    player_message = state.get("player_message") or ""
    tool_calls = state.get("tool_calls") or []
    names = {str(c.get("name")) for c in tool_calls}
    gate_rejected = bool(state.get("gate_rejected"))
    gate_kind = state.get("gate_kind")

    if player_requests_move(player_message) and "move" not in names:
        gate_rejected = True
        gate_kind = gate_kind or "move"
    elif player_requests_interact(player_message) and "interact" not in names:
        gate_rejected = True
        gate_kind = gate_kind or "interact"

    if gate_rejected and not gate_kind:
        gate_kind = "generic"

    out: GraphState = {**state, "gate_rejected": gate_rejected}
    if gate_kind:
        out["gate_kind"] = gate_kind
    return out


def apply_social_event(state: GraphState) -> GraphState:
    raw = state.get("social_perception")
    if not isinstance(raw, dict):
        return state

    try:
        perception = SocialPerception.model_validate(raw)
    except ValueError:
        return state

    player_msg = (state.get("player_message") or "").strip()
    perception = reconcile_social_perception(player_msg, perception)

    room = state.get("room_snapshot") or {}
    result = apply_social_from_llm(
        room_id=state["room_id"],
        npc_id=state.get("npc_id") or "npc-1",
        player_id=_player_id(state),
        perception=perception,
        npc_positions=npc_positions_from_room(room),
    )
    if not result.applied:
        return {**state, "social_applied": False}

    summary = perception.summary.strip()
    return {
        **state,
        "social_applied": True,
        "just_happened_summary": summary,
        "attitude_band": result.band or state.get("attitude_band"),
        "effective_score": result.effective_score
        if result.effective_score is not None
        else state.get("effective_score"),
        "allowed_tools": (
            allowed_tools_for_band(result.band)
            if result.band is not None
            else state.get("allowed_tools")
        ),
    }


def refresh_collective_in_state(state: GraphState) -> GraphState:
    if not state.get("social_applied"):
        return state
    from src.collective.social_turn import CollectiveApplyResult

    result = CollectiveApplyResult(
        applied=True,
        band=state.get("attitude_band"),
        effective_score=state.get("effective_score"),
    )
    return refresh_collective_snapshot(state, result)


def compose_reply(state: GraphState) -> GraphState:
    state = _finalize_hostile_gate(state)
    reply = (state.get("reply_draft") or state.get("reply") or "").strip()
    player_message = state.get("player_message") or ""
    retrieved = state.get("retrieved_memories")
    reply = merge_recall_into_reply(
        player_message,
        reply,
        retrieved,
    )
    tool_calls = state.get("tool_calls") or []

    if not reply and tool_calls:
        if any(call.get("name") != "speak" for call in tool_calls):
            reply = "好的，我正在按你的指示行动。"
        else:
            reply = "好的，我会继续留意周围的情况。"

    if not reply:
        reply = "好的，我会继续留意周围的情况。"

    if state.get("gate_rejected"):
        hint = "（当前关系较紧张，只能对话或等待。）"
        if hint not in reply:
            reply = f"{reply}{hint}"

    reply = sanitize_npc_reply(reply)
    player_message = state.get("player_message") or ""
    if is_recall_question(player_message):
        emit = get_partial_emit()
        if emit is not None and reply:
            emit(reply)
    return {**state, "reply": reply}


def persist_turn_memory(
    state: GraphState,
    *,
    settings: Settings,
    client: httpx.Client,
) -> GraphState:
    reply = state.get("reply") or ""
    tool_calls = state.get("tool_calls") or []
    tool_note = ", ".join(str(c.get("name")) for c in tool_calls if c.get("name"))
    text = reply
    if tool_note:
        text = f"{reply} [tools: {tool_note}]"

    player_message = (state.get("player_message") or "").strip()
    if player_message:
        npc_id = state.get("npc_id") or "npc-1"
        pid = _player_id(state)
        # Write player line before importance LLM — tail may wait minutes on glm-4.7-flash=1;
        # E2E/recent-memories must not block on score_turn_importance (ISSUE-055).
        # process_job may have already fast-appended the player line before emit done.
        if not state.get("_player_line_persisted"):
            append_player_memory(
                client,
                settings,
                state["room_id"],
                player_message,
                importance=DEFAULT_IMPORTANCE,
                npc_id=npc_id,
                player_id=pid,
            )
        player_importance, npc_importance = score_turn_importance(
            player_message,
            text,
            settings,
        )
    else:
        player_importance = 0
        npc_importance = score_importance(f"npc: {text}", settings)
    importance = max(player_importance, npc_importance)
    append_npc_memory(
        client,
        settings,
        state["room_id"],
        text,
        importance=npc_importance,
        npc_id=state.get("npc_id") or "npc-1",
        player_id=_player_id(state),
    )
    count = int(state.get("memory_count") or 0) + 1
    return {**state, "memory_count": count, "turn_importance": importance}


def maybe_reflect_turn(
    state: GraphState,
    *,
    settings: Settings,
    client: httpx.Client,
) -> GraphState:
    count = int(state.get("memory_count") or 0)
    if not should_reflect(count, settings.reflect_every_n):
        return state

    npc_id = state.get("npc_id") or "npc-1"
    recent = fetch_recent_memories(
        client,
        settings,
        state["room_id"],
        limit=settings.reflect_every_n,
        npc_id=npc_id,
        player_id=_player_id(state),
    )
    texts = [row.get("text", "") for row in recent if row.get("text")]
    reflection = run_reflect_llm(texts, settings)
    if reflection:
        store_reflection(
            client,
            settings,
            state["room_id"],
            reflection,
            npc_id=npc_id,
            player_id=_player_id(state),
        )
    return state


def maybe_bulk_summarize_turn(
    state: GraphState,
    *,
    settings: Settings,
    client: httpx.Client,
) -> GraphState:
    count = int(state.get("memory_count") or 0)
    maybe_bulk_summarize(
        client,
        settings,
        state["room_id"],
        count,
        npc_id=state.get("npc_id") or "npc-1",
        player_id=_player_id(state),
    )
    return state


def _npc_graph_thread_id(state: GraphState) -> str:
    room_id = state["room_id"]
    player_id = _player_id(state)
    npc_id = state.get("npc_id") or "npc-1"
    return f"room:{room_id}:player:{player_id}:npc:{npc_id}"


def _npc_turn_initial(
    *,
    room_id: str,
    player_message: str,
    npc_id: str,
    player_id: str,
    recent_turns: list[dict[str, str]] | None = None,
) -> GraphState:
    return {
        "room_id": room_id,
        "npc_id": npc_id,
        "player_id": player_id,
        "player_message": player_message,
        "recent_turns": recent_turns or [],
        "collective_ambiguous": False,
        "tool_calls": [],
        "pending_actions": [],
        "reply": "",
        "reply_draft": "",
        "social_applied": False,
        "collective_updated": False,
        "just_happened_summary": "",
        "speak_intent": "",
        "runtime_relationships": [],
        "canon_context": "",
        "phase_timing_ms": {},
        "trace_run_id": None,
    }


def _with_client_node(cfg: Settings, node_fn):
    def wrapped(state: GraphState) -> GraphState:
        with create_http_client() as client:
            return node_fn(state, settings=cfg, client=client)

    return wrapped


def build_npc_interactive_graph(settings: Settings | None = None):
    """Player-visible path: social perceive → apply → refresh → tools → reply."""
    cfg = settings or get_settings()

    graph = StateGraph(GraphState)
    graph.add_node("fetch_state_and_memory", _with_client_node(cfg, fetch_state_and_memory))
    graph.add_node("llm_social_turn", lambda state: llm_social_turn(state, settings=cfg))
    graph.add_node("apply_social_event", apply_social_event)
    graph.add_node("refresh_collective_in_state", refresh_collective_in_state)
    graph.add_node("apply_tools", _with_client_node(cfg, apply_tools))
    graph.add_node("compose_reply", compose_reply)

    graph.set_entry_point("fetch_state_and_memory")
    graph.add_edge("fetch_state_and_memory", "llm_social_turn")
    graph.add_edge("llm_social_turn", "apply_social_event")
    graph.add_edge("apply_social_event", "refresh_collective_in_state")
    graph.add_edge("refresh_collective_in_state", "apply_tools")
    graph.add_edge("apply_tools", "compose_reply")
    graph.add_edge("compose_reply", END)

    # Single-shot invoke — no Postgres checkpoint (6× writes/speak; Supabase flake → E2E timeout).
    return graph.compile()


def build_npc_graph(settings: Settings | None = None):
    """Full graph including memory tail — compile-only / legacy; runtime uses split invoke."""
    cfg = settings or get_settings()
    checkpointer = get_checkpointer(allow_memory_fallback=True)

    graph = StateGraph(GraphState)
    graph.add_node("fetch_state", _with_client_node(cfg, fetch_state))
    graph.add_node("load_memory_context", _with_client_node(cfg, load_memory_context))
    graph.add_node("llm_turn", lambda state: llm_turn(state, settings=cfg))
    graph.add_node("apply_tools", _with_client_node(cfg, apply_tools))
    graph.add_node("compose_reply", compose_reply)
    graph.add_node("persist_turn_memory", _with_client_node(cfg, persist_turn_memory))
    graph.add_node("maybe_reflect", _with_client_node(cfg, maybe_reflect_turn))
    graph.add_node("maybe_bulk_summarize", _with_client_node(cfg, maybe_bulk_summarize_turn))

    graph.set_entry_point("fetch_state")
    graph.add_edge("fetch_state", "load_memory_context")
    graph.add_edge("load_memory_context", "llm_turn")
    graph.add_edge("llm_turn", "apply_tools")
    graph.add_edge("apply_tools", "compose_reply")
    graph.add_edge("compose_reply", "persist_turn_memory")
    graph.add_edge("persist_turn_memory", "maybe_reflect")
    graph.add_edge("maybe_reflect", "maybe_bulk_summarize")
    graph.add_edge("maybe_bulk_summarize", END)

    return graph.compile(checkpointer=checkpointer)


def run_npc_turn_interactive(
    *,
    room_id: str,
    player_message: str,
    npc_id: str = "npc-1",
    player_id: str = "__legacy__",
    recent_turns: list[dict[str, str]] | None = None,
    settings: Settings | None = None,
) -> GraphState:
    cfg = settings or get_settings()
    graph = build_npc_interactive_graph(cfg)
    initial = _npc_turn_initial(
        room_id=room_id,
        player_message=player_message,
        npc_id=npc_id,
        player_id=player_id,
        recent_turns=recent_turns,
    )
    thread_id = _npc_graph_thread_id(initial)
    return graph.invoke(initial, config={"configurable": {"thread_id": thread_id}})


def run_npc_memory_tail(state: GraphState, settings: Settings | None = None) -> GraphState:
    """Post-reply memory: importance, reflect, summarize — must not block Colyseus done."""
    cfg = settings or get_settings()
    with create_http_client() as client:
        state = persist_turn_memory(state, settings=cfg, client=client)
        state = maybe_collective_refine(state, settings=cfg)
        state = maybe_reflect_turn(state, settings=cfg, client=client)
        state = maybe_bulk_summarize_turn(state, settings=cfg, client=client)
    return state


def run_npc_turn(
    *,
    room_id: str,
    player_message: str,
    npc_id: str = "npc-1",
    player_id: str = "__legacy__",
    settings: Settings | None = None,
) -> GraphState:
    cfg = settings or get_settings()
    state = run_npc_turn_interactive(
        room_id=room_id,
        player_message=player_message,
        npc_id=npc_id,
        player_id=player_id,
        settings=cfg,
    )
    return run_npc_memory_tail(state, cfg)
