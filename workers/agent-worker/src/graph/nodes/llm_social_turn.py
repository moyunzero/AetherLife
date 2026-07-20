from __future__ import annotations

import json
import os
import re
import sys
import time
from typing import Any

import httpx
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

from src.collective.schemas import SOCIAL_SKIP_KIND, SocialPerception, SocialTurnOut
from src.collective.social_turn import infer_social_from_message, player_offers_help, reconcile_social_perception
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
from src.graph.recall_merge import is_recall_question
from src.graph.prompt import SOCIAL_DIALOGUE_CONTEXT_APPEND, append_recent_dialogue_messages
from src.graph.speak_intent import SpeakIntent, is_casual_greeting_only
from src.graph.stable_string_hash import stable_string_hash
from src.graph.speak_system_context import (
    SOCIAL_MEMORY_RECALL_HINT,
    build_speak_system_context,
)
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
from src.llm.invoke_tools import is_empty_tool_args_json_error
from src.llm.openrouter_keys import openrouter_keys
from src.llm.roles import auxiliary_provider_attempts, social_provider_model


SOCIAL_SYSTEM_PROMPT = """你是「以太人生」NPC 的社交感知模块。
分析玩家最新一条消息的社会含义，并起草 NPC 的第一人称回复（尚未执行物理动作）。

输出 **仅 JSON**，且 **必须先写 reply，再写 social**（便于流式展示）：
{"reply":"NPC 第一人称回复","social":{"kind":"ignore","summary":"","delta":0}}

字段说明：
- reply: NPC 对玩家的自然语言回复（必填，JSON 第一个键）
- social.kind: 社交类型（rude/polite/help/praise/apologize/gift/… 或 ignore 表示无社交事件）
- social.summary: <=80 字中性摘要，禁止复读玩家原文
- social.delta: -10..10 建议强度（引擎会按 kind 固定 delta × 人格系数执行，此字段仅供参考）

规则：
- 侮辱、人身攻击、辱骂（嘲笑外貌、诅咒、挑衅）必须 social.kind=rude，禁止用 ignore
- ignore 仅用于无明显社交含义的日常闲聊或纯信息交换
- reply 的情绪必须与 social.kind 一致（rude 时不应同时 kind=ignore）
- Memory summary 仅供背景；若玩家追问具体事实（密码、数字、约定），reply 须用当下口吻直接给出正确答案，可简短；禁止 meta 套话（如「你上次说过/还记得吗/之前告诉我的」）
- 追问具体事实时 social.kind 应为 ignore 或 help，不得判为 rude；低好感可冷淡，但不得编造与记忆矛盾的内容

若玩家要求移动/开门/拿东西，reply 可承诺行动，但本步不调用工具。"""

PHYSICAL_REPLY_APPEND = """\
[系统] 玩家本条消息包含移动/行动指令；游戏引擎已自动解析移动并将执行，你无需在 reply 里重复坐标或逐步描述路径。
请用 1–2 句第一人称中文回复，必须符合当前 NPC 身份、好感与态度，避免千篇一律的套话（不要所有 NPC 都说「好的，我这就去」）。"""

# Up to 3 attempts per provider/model — balances resilience vs. timeout accumulation.
SOCIAL_LLM_MAX_ATTEMPTS = 3

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
    key = msg.strip()
    if is_casual_greeting_only(key):
        pool = _GREETING_REPLIES
    elif _META_BRIEF_RE.search(key):
        pool = _META_BRIEF_REPLIES
    else:
        pool = _DEFAULT_CASUAL_REPLIES
    return pool[stable_string_hash(key) % len(pool)]


def preview_casual_stub(player_message: str, *, speak_intent: str = "casual") -> str | None:
    """Early speakPartial text for CASUAL deterministic turns (before fetch/graph)."""
    turn = _deterministic_social_turn(player_message, speak_intent=speak_intent)
    return turn.reply if turn is not None else None


def _emit_partial_reply(text: str) -> None:
    emit = get_partial_emit()
    cleaned = text.strip()
    if emit is not None and cleaned:
        emit(cleaned)


def _extract_reply_from_json_stream(buffer: str) -> str:
    """Best-effort incremental reply field extraction from streaming JSON."""
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
    npc_id: str = "npc-1",
    recent_turns: list | None = None,
) -> SocialTurnOut | None:
    """Rule-based social + reply — skip social LLM when heuristics are sufficient."""
    msg = player_message.strip()
    if not msg:
        return None
    inferred = infer_social_from_message(msg)
    if inferred is not None:
        if (recent_turns or player_offers_help(msg)) and inferred.kind in ("rude", "help"):
            return None
        if inferred.kind == "rude":
            reply = "请不要这样说话。"
        elif inferred.kind == "help":
            seed = stable_string_hash(f"{npc_id}:{msg}")
            variants = _STUB_HELP_REPLIES.get(npc_id, ("好的，我会尽力帮忙。",))
            reply = variants[seed % len(variants)]
        else:
            reply = f"我听到了：{msg[:120]}"
        return SocialTurnOut(social=inferred, reply=reply)
    # With session history, never emit CASUAL/meta stubs — interactive LLM must see turns.
    if recent_turns:
        return None
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
    inferred = infer_social_from_message(message)
    if inferred is not None:
        return inferred
    return SocialPerception(kind=SOCIAL_SKIP_KIND, summary="", delta=0)


_STUB_MOVE_REPLIES: dict[str, tuple[str, ...]] = {
    "npc-1": ("行，我去。", "哼，知道了，我过去。"),
    "npc-2": ("好呀，我这就去看看。", "嗯，我过去一趟。"),
    "npc-3": ("……好吧，我去。", "知道了，别催。"),
}
_STUB_INTERACT_REPLIES: dict[str, tuple[str, ...]] = {
    "npc-1": ("行，我试试。", "知道了。"),
    "npc-2": ("好呀，我来。", "嗯，我看看。"),
    "npc-3": ("……我试试。", "好吧。"),
}
_STUB_HELP_REPLIES: dict[str, tuple[str, ...]] = {
    "npc-1": ("行，我看看能帮什么。", "哼，知道了。"),
    "npc-2": ("好呀，我尽量帮。", "嗯，我来看看。"),
    "npc-3": ("……好吧，我试试。", "知道了，我去看看。"),
}


def _stub_physical_action_turn(state: GraphState) -> SocialTurnOut:
    """Fallback social + reply when move is injected but social LLM is unavailable."""
    player_message = (state.get("player_message") or "").strip()
    npc_id = state.get("npc_id") or "npc-1"
    inferred = infer_social_from_message(player_message)
    social = inferred if inferred is not None else SocialPerception(
        kind=SOCIAL_SKIP_KIND, summary="", delta=0
    )
    seed = stable_string_hash(f"{npc_id}:{player_message}")
    if player_requests_move(player_message):
        variants = _STUB_MOVE_REPLIES.get(npc_id, ("好的，我这就去。",))
        reply = variants[seed % len(variants)]
    elif player_requests_interact(player_message):
        variants = _STUB_INTERACT_REPLIES.get(npc_id, ("好的，我来试试。",))
        reply = variants[seed % len(variants)]
    else:
        reply = "好的。"
    return SocialTurnOut(social=social, reply=reply)


def run_physical_reply_turn(state: GraphState, *, settings: Settings | None = None) -> SocialTurnOut:
    """In-character reply when move/interact was injected deterministically (no tool LLM)."""
    cfg = settings or get_settings()
    if cfg.llm_mock or os.getenv("LLM_MOCK") == "1":
        return _mock_social_turn(state)
    try:
        return run_social_turn_llm(state, settings=cfg, system_append=PHYSICAL_REPLY_APPEND)
    except LlmCallError:
        return _stub_physical_action_turn(state)


def _mock_social_turn(state: GraphState) -> SocialTurnOut:
    msg = (state.get("player_message") or "").strip()
    social = _mock_social_perception(msg)
    if social.kind == SOCIAL_SKIP_KIND:
        reply = f"（模拟）我听到了：{msg[:120]}" if msg else "（模拟）我听到了你的话。"
    elif social.kind == "rude":
        reply = "请不要这样说话。"
    else:
        reply = f"（模拟）好的，{msg[:80]}"
    return SocialTurnOut(social=social, reply=reply)


def _build_social_messages(
    state: GraphState,
    *,
    system_append: str = "",
) -> list[SystemMessage | HumanMessage | AIMessage]:
    dialogue_append = SOCIAL_DIALOGUE_CONTEXT_APPEND
    combined_append = (
        f"{system_append}\n\n{dialogue_append}".strip()
        if system_append.strip()
        else dialogue_append
    )
    system_text = build_speak_system_context(
        state,
        base_prompt=SOCIAL_SYSTEM_PROMPT,
        memory_suffix=SOCIAL_MEMORY_RECALL_HINT,
        system_append=combined_append,
    )
    player_message = state.get("player_message") or ""
    human = (
        f"Player message: {player_message}\n\n"
        "Respond with JSON only. Put \"reply\" as the first key, then \"social\".\n"
        'Example: {"reply":"…","social":{"kind":"ignore","summary":"","delta":0}}'
    )
    messages: list[SystemMessage | HumanMessage | AIMessage] = [
        SystemMessage(content=system_text),
    ]
    append_recent_dialogue_messages(messages, state.get("recent_turns"))
    messages.append(HumanMessage(content=human))
    return messages


def run_social_turn_llm(
    state: GraphState,
    *,
    settings: Settings | None = None,
    system_append: str = "",
) -> SocialTurnOut:
    cfg = settings or get_settings()
    if cfg.llm_mock or os.getenv("LLM_MOCK") == "1":
        return _mock_social_turn(state)

    messages = _build_social_messages(state, system_append=system_append)
    partial_emit = get_partial_emit()
    player_msg = (state.get("player_message") or "").strip()
    # RECALL: merge_recall_into_reply runs in compose_reply — LLM stream would flash wrong text.
    stream_partial = partial_emit is not None and not is_recall_question(player_msg)
    last_error: BaseException | None = None
    best_salvaged_reply = ""
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
                max_tokens=int(cfg.llm_social_max_tokens),
            )
            for attempt in range(SOCIAL_LLM_MAX_ATTEMPTS):
                try:
                    if stream_partial:
                        buffer = ""
                        last_pushed = ""
                        try:
                            for chunk in llm.stream(messages):
                                piece = getattr(chunk, "content", "") or ""
                                if not piece:
                                    continue
                                buffer += str(piece)
                                visible = _extract_reply_from_json_stream(buffer)
                                if len(visible) > len(last_pushed):
                                    last_pushed = visible
                                    partial_emit(visible)
                        except Exception as stream_exc:
                            if not is_empty_tool_args_json_error(stream_exc):
                                raise
                            print(
                                f"social stream empty JSON/tool-args provider={provider} model={model}",
                                file=sys.stderr,
                            )
                        record_llm_call("social", provider, model)
                        record_phase_ms("t_social_llm_ms", int((time.perf_counter() - t0) * 1000))
                        parsed = _parse_social_turn_json(buffer) if buffer.strip() else None
                        raw_content = buffer
                    else:
                        response = llm.invoke(messages)
                        record_llm_call("social", provider, model)
                        record_phase_ms("t_social_llm_ms", int((time.perf_counter() - t0) * 1000))
                        content = getattr(response, "content", "") or str(response)
                        raw_content = str(content)
                        parsed = _parse_social_turn_json(raw_content)
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
                    if raw_content.strip():
                        salvaged = _extract_reply_from_json_stream(raw_content).strip()
                        if len(salvaged) > len(best_salvaged_reply):
                            best_salvaged_reply = salvaged
                    last_error = ValueError("social turn JSON parse failed")
                    print(
                        f"social JSON parse failed provider={provider} model={model}",
                        file=sys.stderr,
                    )
                    break
                except Exception as exc:
                    last_error = exc
                    if is_empty_tool_args_json_error(exc):
                        print(
                            f"social LLM empty JSON/tool-args provider={provider} model={model}",
                            file=sys.stderr,
                        )
                        break
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

    if best_salvaged_reply:
        print(
            f"social reply salvaged from partial JSON ({len(best_salvaged_reply)} chars)",
            file=sys.stderr,
        )
        return SocialTurnOut(
            social=SocialPerception(
                kind=SOCIAL_SKIP_KIND,
                summary="",
                delta=0,
            ),
            reply=best_salvaged_reply,
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

    last_err: Exception | None = None
    for provider, model in npc_provider_attempts(settings):
        from src.llm.invoke_tools import invoke_tool_bound_llm

        llm = create_chat_model(settings=settings, provider=provider, model=model).bind_tools(tools)
        try:
            response = invoke_tool_bound_llm(llm, messages)
            record_llm_call("main", provider, model)
            tool_calls = parse_tool_calls(response)
            if player_requests_physical_action(player_message) and not has_state_changing_tool(tool_calls):
                retry_messages = [
                    *messages,
                    HumanMessage(content=build_tool_retry_message(room_snapshot)),
                ]
                response = invoke_tool_bound_llm(llm, retry_messages)
                record_llm_call("main", provider, model)
                tool_calls = parse_tool_calls(response)
            record_phase_ms("t_tool_llm_ms", int((time.perf_counter() - t0) * 1000))
            return inject_relative_move_tool(
                tool_calls,
                player_message=player_message,
                room=room_snapshot,
                dialogue_context=dialogue_context,
            )
        except Exception as exc:
            last_err = exc
            continue
    record_phase_ms("t_tool_llm_ms", int((time.perf_counter() - t0) * 1000))
    if last_err is not None:
        raise last_err
    return inject_relative_move_tool(
        [],
        player_message=player_message,
        room=room_snapshot,
        dialogue_context=dialogue_context,
    )


def llm_social_turn(state: GraphState, *, settings: Settings | None = None) -> GraphState:
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
            turn = run_physical_reply_turn(state, settings=cfg)
            _emit_partial_reply(turn.reply)
            return {
                **state,
                "social_perception": turn.social.model_dump(),
                "reply_draft": turn.reply,
                "tool_calls": fast_path,
                "social_applied": False,
                "collective_updated": False,
            }
        turn = run_physical_reply_turn(state, settings=cfg)
        _emit_partial_reply(turn.reply)
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
        npc_id=state.get("npc_id") or "npc-1",
        recent_turns=state.get("recent_turns"),
    )
    if deterministic is not None:
        record_phase_ms("t_social_llm_ms", 0)
        turn = deterministic
        _emit_partial_reply(turn.reply)
    else:
        turn = run_social_turn_llm(state, settings=cfg)

    player_msg = player_message.strip()
    reconciled = reconcile_social_perception(player_msg, turn.social)
    if reconciled.kind != turn.social.kind:
        print(
            "social reconcile (llm_social_turn): "
            f"{turn.social.kind} -> {reconciled.kind} "
            f"player={player_msg[:40]!r}",
            file=sys.stderr,
        )
        turn = turn.model_copy(update={"social": reconciled})

    out_tool_calls: list[dict[str, Any]] = []
    return {
        **state,
        "social_perception": turn.social.model_dump(),
        "reply_draft": turn.reply,
        "tool_calls": out_tool_calls,
        "social_applied": False,
        "collective_updated": False,
    }
