import os
import sys
import time
from typing import Any

import httpx
from langchain_core.messages import HumanMessage
from langgraph.graph import END, StateGraph

from src.config import Settings, get_settings
from src.graph.action_intent import (
    build_tool_retry_message,
    has_state_changing_tool,
    inject_relative_move_tool,
    player_requests_interact,
    player_requests_move,
    player_requests_physical_action,
)
from src.graph.action_sanitize import tool_calls_to_actions
from src.graph.prompt import build_turn_messages, format_memory_summary
from src.graph.reflect import run_reflect_llm, should_reflect
from src.graph.state import GraphState
from src.graph.summarize import maybe_bulk_summarize
from src.graph.reply_sanitize import sanitize_npc_reply
from src.graph.tools import load_tools_for_binding, parse_tool_calls, reply_from_turn
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
    refresh_collective_snapshot,
)
from src.graph.nodes.llm_social_turn import llm_social_turn
from src.memory.client import (
    append_npc_memory,
    append_player_memory,
    fetch_memory_context,
    fetch_recent_memories,
    parse_collective_from_context,
    store_reflection,
)
from src.memory.importance import score_importance, score_turn_importance
from src.persistence.checkpointer import get_checkpointer


def _mock_tool_calls() -> list[dict[str, Any]]:
    # Avoid door cell (3,3) — executor treats objects as blocked.
    return [{"name": "move", "args": {"type": "move", "x": 4, "y": 5}}]


def _game_headers(settings: Settings) -> dict[str, str]:
    headers: dict[str, str] = {}
    if settings.internal_worker_token:
        headers["Authorization"] = f"Bearer {settings.internal_worker_token}"
    return headers


def fetch_state(state: GraphState, *, settings: Settings, client: httpx.Client) -> GraphState:
    room_id = state["room_id"]
    headers = _game_headers(settings)
    player_id = _player_id(state)
    if player_id and player_id != "__legacy__":
        headers["X-Player-Id"] = player_id
    res = client.get(
        f"{settings.game_server_url}/rooms/{room_id}/state",
        headers=headers,
        timeout=10.0,
    )
    res.raise_for_status()
    body = res.json()
    snapshot = body.get("state", {}) or {}
    nearby = body.get("nearbyLore")
    if nearby is not None:
        snapshot = {**snapshot, "nearbyLore": nearby}
    return {**state, "room_snapshot": snapshot}



def _player_id(state: GraphState) -> str:
    return state.get("player_id") or "__legacy__"


def load_memory_context(
    state: GraphState,
    *,
    settings: Settings,
    client: httpx.Client,
) -> GraphState:
    npc_id = state.get("npc_id") or "npc-1"
    ctx = fetch_memory_context(
        client,
        settings,
        state["room_id"],
        state.get("player_message") or "",
        npc_id=npc_id,
        player_id=_player_id(state),
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


def _invoke_llm_turn(
    llm: Any,
    messages: list[Any],
    *,
    player_message: str,
    room_snapshot: dict[str, Any],
) -> tuple[list[dict[str, Any]], str]:
    response = llm.invoke(messages)
    tool_calls = parse_tool_calls(response)
    reply = reply_from_turn(response, tool_calls)

    needs_action = player_requests_physical_action(player_message)
    if needs_action and not has_state_changing_tool(tool_calls):
        retry_messages = [
            *messages,
            HumanMessage(content=build_tool_retry_message(room_snapshot)),
        ]
        response = llm.invoke(retry_messages)
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
    room = state.get("room_snapshot") or {}
    allowed = _allowed_tool_names(state)
    raw_calls = state.get("tool_calls") or []
    tool_calls, stripped = _filter_tool_calls(raw_calls, allowed)
    gate_rejected = bool(state.get("gate_rejected")) or stripped
    state = {**state, "tool_calls": tool_calls, "gate_rejected": gate_rejected}
    actions = tool_calls_to_actions(tool_calls, room=room)

    if not actions:
        return state

    room_id = state["room_id"]
    npc_id = state.get("npc_id") or "npc-1"
    body: dict[str, Any] = {"actions": actions, "actingNpcId": npc_id}
    player_id = _player_id(state)
    if player_id and player_id != "__legacy__":
        body["initiatorPlayerId"] = player_id
    res = client.post(
        f"{settings.game_server_url}/internal/rooms/{room_id}/apply-actions",
        json=body,
        headers=_game_headers(settings),
        timeout=10.0,
    )
    if res.status_code >= 400:
        detail = res.text.strip()
        raise RuntimeError(
            f"apply-actions failed ({res.status_code}): {detail[:500]}",
        )
    body = res.json()
    return {
        **state,
        "room_snapshot": body.get("state", state.get("room_snapshot", {})),
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

    return {**state, "reply": sanitize_npc_reply(reply)}


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
        player_importance, npc_importance = score_turn_importance(
            player_message,
            text,
            settings,
        )
        append_player_memory(
            client,
            settings,
            state["room_id"],
            player_message,
            importance=player_importance,
            npc_id=state.get("npc_id") or "npc-1",
            player_id=_player_id(state),
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
        "trace_run_id": None,
    }


def _with_client_node(cfg: Settings, node_fn):
    def wrapped(state: GraphState) -> GraphState:
        with httpx.Client() as client:
            return node_fn(state, settings=cfg, client=client)

    return wrapped


def build_npc_interactive_graph(settings: Settings | None = None):
    """Player-visible path: social perceive → apply → refresh → tools → reply."""
    cfg = settings or get_settings()
    checkpointer = get_checkpointer(allow_memory_fallback=True)

    graph = StateGraph(GraphState)
    graph.add_node("fetch_state", _with_client_node(cfg, fetch_state))
    graph.add_node("load_memory_context", _with_client_node(cfg, load_memory_context))
    graph.add_node("llm_social_turn", lambda state: llm_social_turn(state, settings=cfg))
    graph.add_node("apply_social_event", apply_social_event)
    graph.add_node("refresh_collective_in_state", refresh_collective_in_state)
    graph.add_node("apply_tools", _with_client_node(cfg, apply_tools))
    graph.add_node("compose_reply", compose_reply)

    graph.set_entry_point("fetch_state")
    graph.add_edge("fetch_state", "load_memory_context")
    graph.add_edge("load_memory_context", "llm_social_turn")
    graph.add_edge("llm_social_turn", "apply_social_event")
    graph.add_edge("apply_social_event", "refresh_collective_in_state")
    graph.add_edge("refresh_collective_in_state", "apply_tools")
    graph.add_edge("apply_tools", "compose_reply")
    graph.add_edge("compose_reply", END)

    return graph.compile(checkpointer=checkpointer)


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
    with httpx.Client() as client:
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
