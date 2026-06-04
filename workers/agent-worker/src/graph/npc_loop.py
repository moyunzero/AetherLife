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
    player_requests_physical_action,
)
from src.graph.prompt import build_turn_messages, format_memory_summary
from src.graph.reflect import run_reflect_llm, should_reflect
from src.graph.state import GraphState
from src.graph.summarize import maybe_bulk_summarize
from src.graph.tools import load_tools_for_binding, parse_tool_calls, reply_from_turn
from src.llm.errors import (
    is_auth_error,
    is_rate_limit_error,
    is_retryable_llm_error,
    retry_after_seconds,
)
from src.llm.factory import create_chat_model, models_to_try
from src.memory.client import (
    append_npc_memory,
    fetch_memory_context,
    fetch_recent_memories,
    store_reflection,
)
from src.memory.importance import score_importance
from src.persistence.checkpointer import get_checkpointer


def _mock_tool_calls() -> list[dict[str, Any]]:
    return [{"name": "move", "args": {"type": "move", "x": 3, "y": 3}}]


def _game_headers(settings: Settings) -> dict[str, str]:
    headers: dict[str, str] = {}
    if settings.internal_worker_token:
        headers["Authorization"] = f"Bearer {settings.internal_worker_token}"
    return headers


def fetch_state(state: GraphState, *, settings: Settings, client: httpx.Client) -> GraphState:
    room_id = state["room_id"]
    res = client.get(
        f"{settings.game_server_url}/rooms/{room_id}/state",
        headers=_game_headers(settings),
        timeout=10.0,
    )
    res.raise_for_status()
    body = res.json()
    return {**state, "room_snapshot": body.get("state", {})}



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
    )
    summary = format_memory_summary(
        latest_bulk=ctx.get("latestBulkSummary"),
        latest_reflection=ctx.get("latestReflection"),
        retrieved=ctx.get("retrieved"),
    )
    return {
        **state,
        "memory_summary": summary,
        "memory_count": int(ctx.get("memoryCount") or 0),
        "retrieved_memories": ctx.get("retrieved") or [],
        "latest_bulk": ctx.get("latestBulkSummary"),
        "latest_reflection": ctx.get("latestReflection"),
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

    return tool_calls, reply


def llm_turn(state: GraphState, *, settings: Settings) -> GraphState:
    if settings.llm_mock or os.getenv("LLM_MOCK") == "1":
        return {**state, "tool_calls": _mock_tool_calls(), "reply": ""}

    messages = build_turn_messages(state)
    tools = load_tools_for_binding()
    player_message = state.get("player_message") or ""
    room_snapshot = state.get("room_snapshot") or {}
    last_error: BaseException | None = None

    for model in models_to_try(settings):
        llm = create_chat_model(settings=settings, model=model).bind_tools(tools)
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
                if is_rate_limit_error(exc) and attempt < 2:
                    time.sleep(retry_after_seconds(exc))
                    continue
                if is_retryable_llm_error(exc):
                    print(
                        f"LLM fallback model={model} error={type(exc).__name__}",
                        file=sys.stderr,
                    )
                    break
                raise

    assert last_error is not None
    raise last_error


def apply_tools(state: GraphState, *, settings: Settings, client: httpx.Client) -> GraphState:
    room = state.get("room_snapshot") or {}
    width = int(room.get("width") or 8)
    height = int(room.get("height") or 8)
    actions: list[dict[str, Any]] = []
    for call in state.get("tool_calls") or []:
        if call.get("name") == "speak":
            continue
        args = call.get("args") or {}
        if "type" not in args and call.get("name"):
            args = {"type": call["name"], **args}
        if args.get("type") == "move":
            args = {
                **args,
                "x": max(0, min(int(args.get("x", 0)), width - 1)),
                "y": max(0, min(int(args.get("y", 0)), height - 1)),
            }
        actions.append(args)

    if not actions:
        return state

    room_id = state["room_id"]
    npc_id = state.get("npc_id") or "npc-1"
    res = client.post(
        f"{settings.game_server_url}/internal/rooms/{room_id}/apply-actions",
        json={"actions": actions, "actingNpcId": npc_id},
        headers=_game_headers(settings),
        timeout=10.0,
    )
    res.raise_for_status()
    body = res.json()
    return {
        **state,
        "room_snapshot": body.get("state", state.get("room_snapshot", {})),
        "pending_actions": actions,
    }


def compose_reply(state: GraphState) -> GraphState:
    reply = (state.get("reply") or "").strip()
    tool_calls = state.get("tool_calls") or []

    if not reply and tool_calls:
        if any(call.get("name") != "speak" for call in tool_calls):
            reply = "好的，我正在按你的指示行动。"
        else:
            reply = "好的，我会继续留意周围的情况。"

    if not reply:
        reply = "好的，我会继续留意周围的情况。"

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

    importance = score_importance(f"npc: {text}", settings)
    append_npc_memory(
        client,
        settings,
        state["room_id"],
        text,
        importance=importance,
        npc_id=state.get("npc_id") or "npc-1",
    )
    count = int(state.get("memory_count") or 0) + 1
    return {**state, "memory_count": count}


def maybe_reflect_turn(
    state: GraphState,
    *,
    settings: Settings,
    client: httpx.Client,
) -> GraphState:
    count = int(state.get("memory_count") or 0)
    if not should_reflect(count, settings.reflect_every_n):
        return state

    recent = fetch_recent_memories(
        client,
        settings,
        state["room_id"],
        limit=settings.reflect_every_n,
        npc_id=state.get("npc_id") or "npc-1",
    )
    texts = [row.get("text", "") for row in recent if row.get("text")]
    reflection = run_reflect_llm(texts, settings)
    if reflection:
        store_reflection(client, settings, state["room_id"], reflection)
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
    )
    return state


def build_npc_graph(settings: Settings | None = None):
    cfg = settings or get_settings()
    checkpointer = get_checkpointer(allow_memory_fallback=True)

    def with_client(node_fn):
        def wrapped(state: GraphState) -> GraphState:
            with httpx.Client() as client:
                return node_fn(state, settings=cfg, client=client)

        return wrapped

    graph = StateGraph(GraphState)
    graph.add_node("fetch_state", with_client(fetch_state))
    graph.add_node("load_memory_context", with_client(load_memory_context))
    graph.add_node("llm_turn", lambda state: llm_turn(state, settings=cfg))
    graph.add_node("apply_tools", with_client(apply_tools))
    graph.add_node("compose_reply", compose_reply)
    graph.add_node("persist_turn_memory", with_client(persist_turn_memory))
    graph.add_node("maybe_reflect", with_client(maybe_reflect_turn))
    graph.add_node("maybe_bulk_summarize", with_client(maybe_bulk_summarize_turn))

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


def run_npc_turn(
    *,
    room_id: str,
    player_message: str,
    npc_id: str = "npc-1",
    settings: Settings | None = None,
) -> GraphState:
    cfg = settings or get_settings()
    graph = build_npc_graph(cfg)
    initial: GraphState = {
        "room_id": room_id,
        "npc_id": npc_id,
        "player_message": player_message,
        "tool_calls": [],
        "pending_actions": [],
        "reply": "",
        "trace_run_id": None,
    }
    thread_id = f"room:{room_id}:npc:{npc_id}"
    return graph.invoke(initial, config={"configurable": {"thread_id": thread_id}})
