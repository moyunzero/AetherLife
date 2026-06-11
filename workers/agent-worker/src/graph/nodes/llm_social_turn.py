from __future__ import annotations

import json
import os
import re
import sys
import time
from typing import Any

import httpx
from langchain_core.messages import HumanMessage, SystemMessage

from src.collective.schemas import SOCIAL_SKIP_KIND, SocialPerception, SocialTurnOut
from src.collective.social_turn import infer_social_from_message, reconcile_social_perception
from src.config import Settings, get_settings
from src.graph.action_intent import (
    build_dialogue_context,
    build_tool_retry_message,
    has_state_changing_tool,
    inject_relative_move_tool,
    player_requests_interact,
    player_requests_move,
    player_requests_physical_action,
)
from src.graph.job_context import get_partial_emit, record_phase_ms
from src.graph.speak_intent import SpeakIntent, is_casual_greeting_only
from src.graph.stable_string_hash import stable_string_hash
from src.graph.prompt import build_room_constraints, format_attitude_context
from src.graph.state import GraphState
from src.graph.tools import load_tools_for_binding, parse_tool_calls, reply_from_turn
from src.llm.call_budget import record_llm_call
from src.llm.errors import (
    LlmCallError,
    is_auth_error,
    is_rate_limit_error,
    is_retryable_llm_error,
    retry_after_seconds,
)
from src.llm.factory import create_chat_model, npc_provider_attempts
from src.llm.openrouter_keys import openrouter_keys
from src.llm.roles import auxiliary_provider_attempts, social_provider_model


SOCIAL_SYSTEM_PROMPT = """你是「以太人生」NPC 的社交感知模块。
分析玩家最新一条消息的社会含义，并起草 NPC 的第一人称回复（尚未执行物理动作）。

输出 JSON 字段：
- social.kind: 社交类型（rude/polite/help/praise/apologize/gift/… 或 ignore 表示无社交事件）
- social.summary: <=80 字中性摘要，禁止复读玩家原文
- social.delta: -10..10 建议强度（引擎会按 kind 固定 delta × 人格系数执行，此字段仅供参考）
- reply: NPC 对玩家的自然语言回复（必填）

规则：
- 侮辱、人身攻击、辱骂（嘲笑外貌、诅咒、挑衅）必须 social.kind=rude，禁止用 ignore
- ignore 仅用于无明显社交含义的日常闲聊或纯信息交换
- reply 的情绪必须与 social.kind 一致（rude 时不应同时 kind=ignore）
- Memory summary 仅供背景；若玩家追问具体事实（密码、数字、约定），reply 须用当下口吻直接给出正确答案，可简短；禁止 meta 套话（如「你上次说过/还记得吗/之前告诉我的」）
- 追问具体事实时 social.kind 应为 ignore 或 help，不得判为 rude；低好感可冷淡，但不得编造与记忆矛盾的内容

若玩家要求移动/开门/拿东西，reply 可承诺行动，但本步不调用工具。"""

# One attempt per provider — APITimeout × 3 retries caused ~135s hangs before fallback.
SOCIAL_LLM_MAX_ATTEMPTS = 1

_META_BRIEF_RE = re.compile(r"简短|一句话|别太长|简单说说|简单说")

_GREETING_REPLIES = (
    "你好呀，需要我做什么？",
    "嗨，我在呢。",
    "你好，有什么我能帮你的吗？",
    "你好，想聊点什么？",
)
_META_BRIEF_REPLIES = (
    "嗯，我在听。",
    "好的，说吧。",
    "明白，请讲。",
    "好，我听着呢。",
)
_DEFAULT_CASUAL_REPLIES = (
    "好的，我明白了。",
    "嗯，知道了。",
    "好，我记下了。",
)


def _pick_casual_reply(msg: str) -> str:
    """
    Selects a deterministic casual reply appropriate for a player's message.
    
    Chooses a reply from a greeting, meta-brief, or default casual reply pool based on the message content and returns a reply deterministically chosen for the same input.
    
    Parameters:
        msg (str): The player's message used to pick the reply pool and select the reply.
    
    Returns:
        str: A reply string from the selected casual reply pool.
    """
    key = msg.strip()
    if is_casual_greeting_only(key):
        pool = _GREETING_REPLIES
    elif _META_BRIEF_RE.search(key):
        pool = _META_BRIEF_REPLIES
    else:
        pool = _DEFAULT_CASUAL_REPLIES
    return pool[stable_string_hash(key) % len(pool)]


def preview_casual_stub(player_message: str, *, speak_intent: str = "casual") -> str | None:
    """
    Return a deterministic casual reply draft when the player message can be handled without invoking the social LLM.
    
    Parameters:
    	player_message (str): The player's raw message.
    	speak_intent (str): Hint about speaking intent (default "casual"); influences deterministic reply selection.
    
    Returns:
    	str | None: Casual reply draft if a deterministic SocialTurnOut is produced, `None` otherwise.
    """
    turn = _deterministic_social_turn(player_message, speak_intent=speak_intent)
    return turn.reply if turn is not None else None


def _emit_partial_reply(text: str) -> None:
    """
    Emit a cleaned partial reply to the configured partial-emitter if available.
    
    Strips surrounding whitespace from `text`; if a partial-emitter function has been registered via `get_partial_emit()` and the cleaned text is non-empty, calls the emitter with the cleaned text.
    
    Parameters:
        text (str): The raw partial reply text to emit.
    """
    emit = get_partial_emit()
    cleaned = text.strip()
    if emit is not None and cleaned:
        emit(cleaned)


def _extract_reply_from_json_stream(buffer: str) -> str:
    """
    Extract the current value of the JSON "reply" field from an incremental/streaming buffer.
    
    Parses the buffer looking for a `"reply"` key and returns the currently extractable string content for that field without the surrounding quotes. Handles common JSON escape sequences so partial streamed escapes are interpreted when complete; returns an empty string if the `"reply"` key has not yet appeared or no extractable content is available.
    
    Parameters:
        buffer (str): The accumulated streaming text (possibly partial JSON).
    
    Returns:
        str: The extracted reply text, or an empty string if the reply field is not yet present or not extractable.
    """
    match = re.search(r'"reply"\s*:\s*"', buffer)
    if not match:
        return ""
    i = match.end()
    chars: list[str] = []
    while i < len(buffer):
        ch = buffer[i]
        if ch == "\\":
            if i + 1 >= len(buffer):
                break
            nxt = buffer[i + 1]
            if nxt == "n":
                chars.append("\n")
            elif nxt == "t":
                chars.append("\t")
            elif nxt in {'"', "\\", "/"}:
                chars.append(nxt)
            elif nxt == "u" and i + 5 < len(buffer):
                try:
                    chars.append(chr(int(buffer[i + 2 : i + 6], 16)))
                    i += 5
                except ValueError:
                    break
            else:
                chars.append(nxt)
            i += 2
            continue
        if ch == '"':
            break
        chars.append(ch)
        i += 1
    return "".join(chars)


def _deterministic_social_turn(
    player_message: str,
    *,
    speak_intent: str = "",
) -> SocialTurnOut | None:
    """
    Determine a deterministic social perception and reply from the player's message when simple heuristics suffice.
    
    Produces a fixed or heuristic `SocialTurnOut` for short-circuit cases (empty messages return `None`). Specific outcomes:
    - If the message's social inference is available: returns that perception with a canned reply (rude → "请不要这样说话。", help → "好的，我会尽力帮忙。", otherwise an acknowledgement).
    - If the speak intent indicates casual or the message requests a brief reply and the player is not asking for physical actions: returns a skip-kind social perception with a deterministic casual reply.
    - If the message is a casual greeting only and not requesting physical action: returns a skip-kind social perception with a deterministic casual reply.
    - Otherwise returns `None` to signal that an LLM-based social turn is required.
    
    Parameters:
        speak_intent (str): optional intent hint (e.g., `"casual"`) that biases toward short/casual replies.
    
    Returns:
        SocialTurnOut | None: a deterministic social turn when heuristics apply, `None` if no deterministic decision can be made.
    """
    msg = player_message.strip()
    if not msg:
        return None
    inferred = infer_social_from_message(msg)
    if inferred is not None:
        if inferred.kind == "rude":
            reply = "请不要这样说话。"
        elif inferred.kind == "help":
            reply = "好的，我会尽力帮忙。"
        else:
            reply = f"我听到了：{msg[:120]}"
        return SocialTurnOut(social=inferred, reply=reply)
    if speak_intent == SpeakIntent.CASUAL.value or _META_BRIEF_RE.search(msg):
        if not player_requests_physical_action(msg):
            return SocialTurnOut(
                social=SocialPerception(kind=SOCIAL_SKIP_KIND, summary="", delta=0),
                reply=_pick_casual_reply(msg),
            )
    if not player_requests_physical_action(msg) and is_casual_greeting_only(msg):
        return SocialTurnOut(
            social=SocialPerception(kind=SOCIAL_SKIP_KIND, summary="", delta=0),
            reply=_pick_casual_reply(msg),
        )
    return None


def _parse_social_turn_json(content: str) -> SocialTurnOut | None:
    """
    Parse a raw LLM output string and extract a SocialTurnOut if present.
    
    Attempts to interpret the provided content (which may include code fences or extra surrounding text) as JSON describing a social turn. If full JSON parsing fails, tries to recover the key fields (social.kind, social.summary, social.delta, and reply) and construct a SocialTurnOut. Returns None when a valid social turn cannot be extracted.
    
    Parameters:
        content (str): Raw LLM response text, possibly wrapped in code fences or containing additional non-JSON text.
    
    Returns:
        SocialTurnOut | None: A parsed SocialTurnOut when extraction succeeds, `None` otherwise.
    """
    text = content.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
        text = re.sub(r"\s*```$", "", text)

    candidates: list[str] = [text]
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if match:
        candidates.append(match.group(0))

    for candidate in candidates:
        for cleaned in (candidate, re.sub(r",\s*([}\]])", r"\1", candidate)):
            try:
                parsed = json.loads(cleaned)
                return SocialTurnOut.model_validate(parsed)
            except (json.JSONDecodeError, ValueError):
                continue

    reply_match = re.search(r'"reply"\s*:\s*"((?:\\.|[^"\\])*)"', text, re.DOTALL)
    if reply_match:
        kind_match = re.search(r'"kind"\s*:\s*"([^"]+)"', text)
        summary_match = re.search(r'"summary"\s*:\s*"((?:\\.|[^"\\])*)"', text)
        delta_match = re.search(r'"delta"\s*:\s*(-?\d+)', text)
        try:
            reply = json.loads(f'"{reply_match.group(1)}"')
        except json.JSONDecodeError:
            reply = reply_match.group(1)
        kind = kind_match.group(1) if kind_match else SOCIAL_SKIP_KIND
        summary = summary_match.group(1) if summary_match else ""
        delta = int(delta_match.group(1)) if delta_match else 0
        try:
            return SocialTurnOut(
                social=SocialPerception(kind=kind, summary=summary, delta=delta),
                reply=str(reply),
            )
        except ValueError:
            return None
    return None


def _mock_social_perception(message: str) -> SocialPerception:
    """
    Return a SocialPerception inferred from the message or a default skip perception.
    
    Returns:
        SocialPerception: The result of `infer_social_from_message(message)` if available; otherwise a perception with `kind=SOCIAL_SKIP_KIND`, `summary=""`, and `delta=0`.
    """
    inferred = infer_social_from_message(message)
    if inferred is not None:
        return inferred
    return SocialPerception(kind=SOCIAL_SKIP_KIND, summary="", delta=0)


def _stub_physical_action_turn(player_message: str) -> SocialTurnOut:
    """Deterministic social + reply when move/interact target is parsed without LLM."""
    inferred = infer_social_from_message(player_message)
    social = inferred if inferred is not None else SocialPerception(
        kind=SOCIAL_SKIP_KIND, summary="", delta=0
    )
    if player_requests_move(player_message):
        reply = "好的，我这就去。"
    elif player_requests_interact(player_message):
        reply = "好的，我来试试。"
    else:
        reply = "好的。"
    return SocialTurnOut(social=social, reply=reply)


def _mock_social_turn(state: GraphState) -> SocialTurnOut:
    """
    Produce a deterministic mock SocialTurnOut based on state["player_message"] for use in mock/preview mode.
    
    Parameters:
        state (GraphState): Graph state containing a "player_message" key whose value is the player's text.
    
    Returns:
        SocialTurnOut: A mock social perception and reply draft. The reply is:
          - "（模拟）我听到了：{msg[:120]}" when the inferred social kind is the skip kind and the message is non-empty, or "（模拟）我听到了你的话。" if empty;
          - "请不要这样说话。" when the inferred social kind is "rude";
          - "（模拟）好的，{msg[:80]}" for all other kinds.
    """
    msg = (state.get("player_message") or "").strip()
    social = _mock_social_perception(msg)
    if social.kind == SOCIAL_SKIP_KIND:
        reply = f"（模拟）我听到了：{msg[:120]}" if msg else "（模拟）我听到了你的话。"
    elif social.kind == "rude":
        reply = "请不要这样说话。"
    else:
        reply = f"（模拟）好的，{msg[:80]}"
    return SocialTurnOut(social=social, reply=reply)


def _build_social_messages(state: GraphState) -> list[SystemMessage | HumanMessage]:
    room = state.get("room_snapshot") or {}
    attitude = format_attitude_context(
        band=state.get("attitude_band"),
        effective_score=state.get("effective_score"),
        summaries=state.get("collective_summaries"),
    )
    system_text = f"{SOCIAL_SYSTEM_PROMPT}\n{build_room_constraints(room)}\n\n{attitude}"
    memory = (state.get("memory_summary") or "").strip()
    if memory:
        system_text = f"{system_text}\n\nMemory summary:\n{memory}"
    player_message = state.get("player_message") or ""
    return [
        SystemMessage(content=system_text),
        HumanMessage(content=f"Player message: {player_message}"),
    ]


def run_social_turn_llm(state: GraphState, *, settings: Settings | None = None) -> SocialTurnOut:
    """
    Run the social-turn LLM (or mock) to produce a SocialTurnOut for the current player message.
    
    Builds and sends a social prompt based on `state` (including room and memory context), streams partial reply text if supported, parses the LLM's JSON output into a SocialTurnOut, and reconciles the parsed social perception with heuristics. Falls back to a deterministic mock or a safe skip-social reply when parsing or providers fail.
    
    Parameters:
        state (GraphState): Current graph state containing at least `player_message` and context used to build the prompt.
        settings (Settings | None): Optional settings override; when omitted the global configuration is used.
    
    Returns:
        SocialTurnOut: The parsed and reconciled social perception plus the NPC reply draft. On full failure returns a skip-kind SocialTurnOut with a fallback reply.
    
    Raises:
        LlmCallError: If an LLM provider error (non-retryable or auth) prevents producing a valid response.
        Exception: Authentication errors from providers are re-raised directly.
    """
    cfg = settings or get_settings()
    if cfg.llm_mock or os.getenv("LLM_MOCK") == "1":
        return _mock_social_turn(state)

    messages = _build_social_messages(state)
    partial_emit = get_partial_emit()
    last_error: BaseException | None = None
    primary = social_provider_model(cfg)
    last_provider = primary[0]
    last_model = primary[1]
    t0 = time.perf_counter()

    for provider, model in auxiliary_provider_attempts(
        cfg,
        primary=primary,
        fallback_provider=cfg.llm_provider_social_fallback,
    ):
        last_provider = provider
        last_model = model
        use_openrouter = provider == "openrouter"
        key_candidates: list[str | None] = openrouter_keys(cfg) if use_openrouter else [None]
        if use_openrouter and not key_candidates:
            key_candidates = [None]

        for key_idx, or_key in enumerate(key_candidates):
            llm = create_chat_model(
                settings=cfg,
                provider=provider,
                model=model,
                api_key=or_key,
                request_timeout=float(cfg.llm_social_request_timeout),
            )
            for attempt in range(SOCIAL_LLM_MAX_ATTEMPTS):
                try:
                    if partial_emit is not None:
                        buffer = ""
                        last_pushed = ""
                        for chunk in llm.stream(messages):
                            piece = getattr(chunk, "content", "") or ""
                            if not piece:
                                continue
                            buffer += str(piece)
                            visible = _extract_reply_from_json_stream(buffer)
                            if len(visible) > len(last_pushed):
                                last_pushed = visible
                                partial_emit(visible)
                        record_llm_call("social", provider, model)
                        record_phase_ms("t_social_llm_ms", int((time.perf_counter() - t0) * 1000))
                        parsed = _parse_social_turn_json(buffer)
                    else:
                        response = llm.invoke(messages)
                        record_llm_call("social", provider, model)
                        record_phase_ms("t_social_llm_ms", int((time.perf_counter() - t0) * 1000))
                        content = getattr(response, "content", "") or str(response)
                        parsed = _parse_social_turn_json(str(content))
                    if parsed is not None:
                        player_msg = (state.get("player_message") or "").strip()
                        reconciled = reconcile_social_perception(
                            player_msg,
                            parsed.social,
                        )
                        if reconciled.kind != parsed.social.kind:
                            print(
                                "social reconcile: "
                                f"{parsed.social.kind} -> {reconciled.kind} "
                                f"player={player_msg[:40]!r}",
                                file=sys.stderr,
                            )
                        return parsed.model_copy(update={"social": reconciled})
                    last_error = ValueError("social turn JSON parse failed")
                    print(
                        f"social JSON parse failed provider={provider} model={model}",
                        file=sys.stderr,
                    )
                    break
                except Exception as exc:
                    last_error = exc
                    if is_auth_error(exc):
                        raise
                    if is_rate_limit_error(exc):
                        if use_openrouter and key_idx + 1 < len(key_candidates):
                            break
                        if attempt < 2:
                            time.sleep(retry_after_seconds(exc))
                            continue
                    if is_retryable_llm_error(exc):
                        print(
                            f"social LLM fallback provider={provider} model={model} error={type(exc).__name__}",
                            file=sys.stderr,
                        )
                        break
                    raise
            if last_error and is_rate_limit_error(last_error) and key_idx + 1 < len(key_candidates):
                continue
            if last_error and is_retryable_llm_error(last_error):
                break

    record_phase_ms("t_social_llm_ms", int((time.perf_counter() - t0) * 1000))

    if last_error is not None and not isinstance(last_error, ValueError):
        if is_auth_error(last_error):
            raise LlmCallError(last_error, provider=last_provider, model=last_model) from last_error
        if not is_retryable_llm_error(last_error):
            raise LlmCallError(last_error, provider=last_provider, model=last_model) from last_error
        print(
            f"social LLM degraded provider={last_provider} model={last_model} "
            f"error={type(last_error).__name__}",
            file=sys.stderr,
        )

    msg = (state.get("player_message") or "").strip()
    return SocialTurnOut(
        social=SocialPerception(
            kind=SOCIAL_SKIP_KIND,
            summary="(social parse failed)",
            delta=0,
        ),
        reply=f"我听到了：{msg[:120]}" if msg else "我在听。",
    )


def _invoke_tool_turn(
    state: GraphState,
    *,
    settings: Settings,
    reply_draft: str,
) -> list[dict[str, Any]]:
    """
    Builds and returns a list of planned tool calls for the current turn, injecting any required relative movement adjustments.
    
    If mock mode is enabled, returns a deterministic mock tool call plan. Otherwise, selects allowed tools, prompts an NPC-capable LLM (with the drafted reply included) to produce tool calls, and, when the player requests a physical action but the first LLM response contains no state-changing tool, retries once with an explicit retry prompt. The returned calls are post-processed with inject_relative_move_tool to convert absolute moves into relative movement instructions.
    
    Parameters:
        state (GraphState): Current graph state containing keys like "player_message", "room_snapshot", "recent_turns", and "allowed_tools".
        settings (Settings): Runtime settings / configuration used to create LLM clients and detect mock mode.
        reply_draft (str): The drafted NPC reply to include in the prompt so the tool planner can align actions with the reply.
    
    Returns:
        list[dict[str, Any]]: A list of tool call dictionaries (each with at least "name" and "args") after relative-move injection. In mock mode this is a deterministic mock plan; on failure it returns an empty plan with movement injection applied.
    """
    t0 = time.perf_counter()
    if settings.llm_mock or os.getenv("LLM_MOCK") == "1":
        room_snapshot = state.get("room_snapshot") or {}
        mock_calls = [{"name": "move", "args": {"type": "move", "x": 4, "y": 5}}]
        dialogue_context = build_dialogue_context(
            state.get("player_message") or "",
            state.get("recent_turns"),
        )
        record_phase_ms("t_tool_llm_ms", int((time.perf_counter() - t0) * 1000))
        return inject_relative_move_tool(
            mock_calls,
            player_message=state.get("player_message") or "",
            room=room_snapshot,
            dialogue_context=dialogue_context,
        )

    allowed = set(state.get("allowed_tools") or [])
    tools = [
        tool
        for tool in load_tools_for_binding()
        if tool["function"]["name"] in allowed
    ]
    player_message = state.get("player_message") or ""
    room_snapshot = state.get("room_snapshot") or {}
    dialogue_context = build_dialogue_context(player_message, state.get("recent_turns"))
    messages = _build_social_messages(state)
    messages.append(
        HumanMessage(
            content=(
                f"[系统] 已起草回复：{reply_draft}\n"
                "若玩家要求物理动作，本轮必须调用 move/interact/wait 工具。"
            ),
        ),
    )

    for provider, model in npc_provider_attempts(settings):
        llm = create_chat_model(settings=settings, provider=provider, model=model).bind_tools(tools)
        try:
            response = llm.invoke(messages)
            record_llm_call("main", provider, model)
            tool_calls = parse_tool_calls(response)
            if player_requests_physical_action(player_message) and not has_state_changing_tool(tool_calls):
                retry_messages = [
                    *messages,
                    HumanMessage(content=build_tool_retry_message(room_snapshot)),
                ]
                response = llm.invoke(retry_messages)
                record_llm_call("main", provider, model)
                tool_calls = parse_tool_calls(response)
            record_phase_ms("t_tool_llm_ms", int((time.perf_counter() - t0) * 1000))
            return inject_relative_move_tool(
                tool_calls,
                player_message=player_message,
                room=room_snapshot,
                dialogue_context=dialogue_context,
            )
        except Exception:
            continue
    record_phase_ms("t_tool_llm_ms", int((time.perf_counter() - t0) * 1000))
    return inject_relative_move_tool(
        [],
        player_message=player_message,
        room=room_snapshot,
        dialogue_context=dialogue_context,
    )


def llm_social_turn(state: GraphState, *, settings: Settings | None = None) -> GraphState:
    """
    Orchestrates an NPC "social" turn: determines a SocialPerception, drafts the NPC reply, and optionally produces tool call plans for physical actions, returning an updated GraphState.
    
    Parameters:
        state (GraphState): Current graph state; expected keys include "player_message", "speak_intent", "room_snapshot", and "recent_turns".
        settings (Settings | None): Optional runtime configuration; if omitted the global settings are used.
    
    Returns:
        GraphState: A copy of `state` updated with:
            - "social_perception": the perceived social info as a serializable mapping,
            - "reply_draft": the NPC's drafted reply string,
            - "tool_calls": list of planned tool call dicts (empty when no physical action planned),
            - "social_applied": False,
            - "collective_updated": False.
    """
    cfg = settings or get_settings()
    player_message = state.get("player_message") or ""
    speak_intent = state.get("speak_intent") or ""
    room_snapshot = state.get("room_snapshot") or {}
    dialogue_context = build_dialogue_context(player_message, state.get("recent_turns"))
    is_physical = (
        speak_intent == SpeakIntent.PHYSICAL.value
        or player_requests_physical_action(player_message)
    )

    if is_physical:
        fast_path = inject_relative_move_tool(
            [],
            player_message=player_message,
            room=room_snapshot,
            dialogue_context=dialogue_context,
        )
        if has_state_changing_tool(fast_path):
            turn = _stub_physical_action_turn(player_message)
            _emit_partial_reply(turn.reply)
            record_phase_ms("t_social_llm_ms", 0)
            return {
                **state,
                "social_perception": turn.social.model_dump(),
                "reply_draft": turn.reply,
                "tool_calls": fast_path,
                "social_applied": False,
                "collective_updated": False,
            }
        turn = _stub_physical_action_turn(player_message)
        _emit_partial_reply(turn.reply)
        record_phase_ms("t_social_llm_ms", 0)
        tool_calls = _invoke_tool_turn(state, settings=cfg, reply_draft=turn.reply)
        return {
            **state,
            "social_perception": turn.social.model_dump(),
            "reply_draft": turn.reply,
            "tool_calls": tool_calls,
            "social_applied": False,
            "collective_updated": False,
        }

    deterministic = _deterministic_social_turn(
        player_message,
        speak_intent=speak_intent,
    )
    if deterministic is not None:
        record_phase_ms("t_social_llm_ms", 0)
        turn = deterministic
        _emit_partial_reply(turn.reply)
    else:
        turn = run_social_turn_llm(state, settings=cfg)

    return {
        **state,
        "social_perception": turn.social.model_dump(),
        "reply_draft": turn.reply,
        "tool_calls": [],
        "social_applied": False,
        "collective_updated": False,
    }
