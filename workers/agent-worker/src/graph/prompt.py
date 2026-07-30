import json
from typing import Any

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

from src.graph.action_intent import player_requests_physical_action
from src.graph.speak_system_context import build_speak_system_context
from src.graph.state import GraphState
from src.collective.constants import BAND_LABEL_ZH

NPC_SYSTEM_PROMPT = """你是「以太人生」中的 NPC 助手。

行为规则：
1. 先用自然语言直接回应玩家（问候、闲聊、澄清意图）。
2. 玩家要求移动、开门、拿东西、等待等物理行为时，必须在同一轮调用 move / interact / wait 工具；不要只用文字说「我现在就去…」。
3. 不要口头声称已经完成某个动作；若需要改变世界状态，必须调用对应工具。
4. 可用 speak 工具对玩家说话（targetId 使用 "player"），或在回复文本中直接回答；但 speak 不能代替 move / interact。
5. 以房间 JSON 快照为准，不要编造不存在的状态或坐标。
6. 下方 Recent dialogue 是真实会话历史；请针对玩家**最新一条**消息作答，勿复读上一轮几乎相同的回复。"""

RECENT_DIALOGUE_TURN_LIMIT = 10

SOCIAL_DIALOGUE_CONTEXT_APPEND = """\
Recent dialogue 是真实会话历史。请针对玩家**最新一条**消息作答，结合上文语境；勿复读上一轮几乎相同的回复。
若玩家主动提出帮助（如「我可以帮你」），须以第一人称接受或回应，**禁止**像玩家向你求助一样说「我会尽力帮你」。"""


def append_recent_dialogue_messages(
    messages: list[SystemMessage | HumanMessage | AIMessage],
    recent_turns: list | dict[str, str] | None,
    *,
    limit: int = RECENT_DIALOGUE_TURN_LIMIT,
) -> None:
    """Append Human/AI alternating chain from in-session transcript."""
    turns = recent_turns if isinstance(recent_turns, list) else []
    for turn in turns[-limit:]:
        if not isinstance(turn, dict):
            continue
        role = (turn.get("role") or "").strip()
        text = (turn.get("text") or "").strip()
        if not text:
            continue
        if role == "player":
            messages.append(HumanMessage(content=text))
        elif role == "npc":
            messages.append(AIMessage(content=text))


def format_memory_summary(
    *,
    latest_bulk: str | None,
    latest_reflection: str | None,
    retrieved: list[dict[str, Any]] | None,
) -> str:
    bulk = (latest_bulk or "").strip() or "(none)"
    reflection = (latest_reflection or "").strip() or "(none)"

    lines = [
        "Bulk summary:",
        bulk,
        "",
        "Reflection:",
        reflection,
        "",
        "Retrieved memories:",
    ]

    items = retrieved or []
    if not items:
        lines.append("- (none)")
    else:
        for item in items:
            text = (item.get("text") or "").strip()
            score = item.get("score")
            suffix = f" (score: {score:.3f})" if isinstance(score, (int, float)) else ""
            lines.append(f"- {text}{suffix}")

    return "\n".join(lines)


def build_room_constraints(room: dict[str, Any]) -> str:
    width = int(room.get("width") or 8)
    height = int(room.get("height") or 8)
    max_x = max(0, width - 1)
    max_y = max(0, height - 1)
    lines = [
        f"6. 房间网格 {width}×{height}，合法坐标 x∈[0,{max_x}]，y∈[0,{max_y}]，越界 move 会失败。",
    ]
    player = room.get("player") or {}
    lines.append(
        f"7. 本次发起指令的玩家 @ ({player.get('x')},{player.get('y')})；"
        "「我/我的/下方/旁边」等相对位置仅相对该玩家换算目标格后调用 move。"
        "房间可能有多名玩家，禁止使用其他玩家或 NPC 的坐标代替该玩家。"
    )
    lines.append("8. 房间 NPC（id / 名字 / 坐标 / 背包）：")
    for npc in room.get("npcs") or []:
        npc_id = npc.get("id")
        if not npc_id:
            continue
        inventory = npc.get("inventory") or []
        inv_text = ", ".join(inventory) if inventory else "(empty)"
        lines.append(
            f"   - {npc_id} {npc.get('name')} @ ({npc.get('x')},{npc.get('y')}) inventory=[{inv_text}]"
        )
    for obj in room.get("objects") or []:
        oid = obj.get("id")
        if not oid:
            continue
        lines.append(
            f"   - {oid} ({obj.get('kind')}) 位于 ({obj.get('x')},{obj.get('y')})，state={obj.get('state')}"
        )
    lines.append("9. 开门/交互：interact + objectId（使用上表对象 id）。")
    lines.append("10. 移动：move + 合法 x,y（相对指令须先换算为坐标）。")
    lines.append("11. 物品转移：transfer + itemId + toNpcId（只能转出自己背包中的物品）。")
    nearby = format_nearby_lore(room)
    if nearby:
        lines.append(nearby)
    return "\n".join(lines)


def format_nearby_lore(room: dict[str, Any]) -> str:
    entries = room.get("nearbyLore") or []
    if not entries:
        return ""
    lines = ["12. 邻近地块叙事（仅供参考，勿编造未列出的地点）："]
    for item in entries:
        name = (item.get("nameZh") or "").strip()
        flavor = (item.get("flavorOneLine") or "").strip()
        cx = item.get("cx")
        cy = item.get("cy")
        if not name:
            continue
        suffix = f" — {flavor}" if flavor else ""
        lines.append(f"   - chunk ({cx},{cy}) {name}{suffix}")
    return "\n".join(lines) if len(lines) > 1 else ""


def format_attitude_context(
    *,
    band: str | None,
    effective_score: int | None,
    summaries: list[str] | None,
    just_happened: str | None = None,
    mood: str | None = None,
    beliefs: list[str] | None = None,
    summary: str | None = None,
) -> str:
    resolved_band = band or "neutral"
    label = BAND_LABEL_ZH.get(resolved_band, resolved_band)
    score_text = effective_score if effective_score is not None else "?"
    lines = [
        "Attitude toward this player:",
        f"- band: {resolved_band} ({label})",
        f"- effectiveScore: {score_text}",
    ]
    if just_happened and just_happened.strip():
        lines.append(f"- justHappened: {just_happened.strip()[:80]}")
    mood_text = (mood or "").strip()
    if mood_text:
        lines.append(f"- mood: {mood_text}")
    belief_items = [b.strip() for b in (beliefs or []) if b and b.strip()]
    if belief_items:
        lines.append("- beliefs:")
        for item in belief_items[:5]:
            lines.append(f"  · {item}")
    summary_text = (summary or "").strip()
    if summary_text:
        lines.append(f"- summary: {summary_text}")
    items = [s.strip() for s in (summaries or []) if s and s.strip()]
    if items:
        lines.append("- recent collective summaries:")
        for item in items[:5]:
            lines.append(f"  · {item}")
    return "\n".join(lines)


def build_turn_messages(state: GraphState) -> list[SystemMessage | HumanMessage | AIMessage]:
    room = state.get("room_snapshot") or {}
    room_json = json.dumps(room, ensure_ascii=False)
    if len(room_json) > 1500:
        room_json = room_json[:1500] + "…"

    system_text = build_speak_system_context(
        state,
        base_prompt=NPC_SYSTEM_PROMPT,
        include_just_happened=True,
    )

    messages: list[SystemMessage | HumanMessage | AIMessage] = [
        SystemMessage(content=system_text)
    ]

    append_recent_dialogue_messages(messages, state.get("recent_turns"))

    player_message = state.get("player_message") or ""
    human_text = f"Player message: {player_message}\n\nRoom snapshot (JSON):\n{room_json}"
    if player_requests_physical_action(player_message):
        human_text = (
            f"{human_text}\n\n"
            "[系统] 本轮必须调用 move / interact / wait 工具执行物理动作，禁止仅用文字承诺。"
        )
    messages.append(HumanMessage(content=human_text))
    return messages
