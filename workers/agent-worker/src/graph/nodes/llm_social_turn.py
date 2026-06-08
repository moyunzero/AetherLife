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
    build_tool_retry_message,
    has_state_changing_tool,
    inject_relative_move_tool,
    player_requests_physical_action,
)
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

若玩家要求移动/开门/拿东西，reply 可承诺行动，但本步不调用工具。"""


def _parse_social_turn_json(content: str) -> SocialTurnOut | None:
    text = content.strip()
    try:
        parsed = json.loads(text)
        return SocialTurnOut.model_validate(parsed)
    except (json.JSONDecodeError, ValueError):
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if match:
            try:
                return SocialTurnOut.model_validate(json.loads(match.group(0)))
            except (json.JSONDecodeError, ValueError):
                return None
    return None


def _mock_social_perception(message: str) -> SocialPerception:
    inferred = infer_social_from_message(message)
    if inferred is not None:
        return inferred
    return SocialPerception(kind=SOCIAL_SKIP_KIND, summary="", delta=0)


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


def _build_social_messages(state: GraphState) -> list[SystemMessage | HumanMessage]:
    room = state.get("room_snapshot") or {}
    attitude = format_attitude_context(
        band=state.get("attitude_band"),
        effective_score=state.get("effective_score"),
        summaries=state.get("collective_summaries"),
    )
    system_text = f"{SOCIAL_SYSTEM_PROMPT}\n{build_room_constraints(room)}\n\n{attitude}"
    player_message = state.get("player_message") or ""
    return [
        SystemMessage(content=system_text),
        HumanMessage(content=f"Player message: {player_message}"),
    ]


def run_social_turn_llm(state: GraphState, *, settings: Settings | None = None) -> SocialTurnOut:
    cfg = settings or get_settings()
    if cfg.llm_mock or os.getenv("LLM_MOCK") == "1":
        return _mock_social_turn(state)

    messages = _build_social_messages(state)
    last_error: BaseException | None = None
    primary = social_provider_model(cfg)
    last_provider = primary[0]
    last_model = primary[1]

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
            )
            for attempt in range(3):
                try:
                    response = llm.invoke(messages)
                    record_llm_call("social", provider, model)
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
    if settings.llm_mock or os.getenv("LLM_MOCK") == "1":
        room_snapshot = state.get("room_snapshot") or {}
        mock_calls = [{"name": "move", "args": {"type": "move", "x": 4, "y": 5}}]
        return inject_relative_move_tool(
            mock_calls,
            player_message=state.get("player_message") or "",
            room=room_snapshot,
        )

    allowed = set(state.get("allowed_tools") or [])
    tools = [
        tool
        for tool in load_tools_for_binding()
        if tool["function"]["name"] in allowed
    ]
    player_message = state.get("player_message") or ""
    room_snapshot = state.get("room_snapshot") or {}
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
            return inject_relative_move_tool(
                tool_calls,
                player_message=player_message,
                room=room_snapshot,
            )
        except Exception:
            continue
    return inject_relative_move_tool(
        [],
        player_message=player_message,
        room=room_snapshot,
    )


def llm_social_turn(state: GraphState, *, settings: Settings | None = None) -> GraphState:
    cfg = settings or get_settings()
    turn = run_social_turn_llm(state, settings=cfg)
    player_message = state.get("player_message") or ""
    room_snapshot = state.get("room_snapshot") or {}
    tool_calls: list[dict[str, Any]] = []
    if player_requests_physical_action(player_message):
        fast_path = inject_relative_move_tool(
            [],
            player_message=player_message,
            room=room_snapshot,
        )
        if has_state_changing_tool(fast_path):
            tool_calls = fast_path
        else:
            tool_calls = _invoke_tool_turn(state, settings=cfg, reply_draft=turn.reply)

    return {
        **state,
        "social_perception": turn.social.model_dump(),
        "reply_draft": turn.reply,
        "tool_calls": tool_calls,
        "social_applied": False,
        "collective_updated": False,
    }
