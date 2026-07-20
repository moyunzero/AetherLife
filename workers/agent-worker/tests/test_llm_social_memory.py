from langchain_core.messages import AIMessage, HumanMessage

from src.graph.nodes.llm_social_turn import _build_social_messages
from src.graph.prompt import format_memory_summary
from src.graph.state import GraphState


def test_build_social_messages_includes_memory_summary():
    summary = format_memory_summary(
        latest_bulk="(none)",
        latest_reflection="(none)",
        retrieved=[{"text": "玩家说门禁密码是 7", "score": 0.91}],
    )
    state: GraphState = {
        "room_id": "default",
        "player_message": "你还记得门禁密码是什么吗？",
        "npc_id": "npc-1",
        "player_id": "p1",
        "room_snapshot": {"width": 8, "height": 8, "player": {"x": 1, "y": 1}, "npcs": []},
        "memory_summary": summary,
    }
    messages = _build_social_messages(state)
    system = messages[0].content
    human = messages[-1].content
    assert "Memory summary:" in system
    assert "门禁密码是 7" in system
    assert "禁止 meta 套话" in system
    assert "必须先写 reply" in system or "reply" in system
    assert "我会尽力帮你" in system
    assert "Put \"reply\" as the first key" in human


def test_build_social_messages_includes_recent_dialogue():
    state: GraphState = {
        "room_id": "default",
        "player_message": "我可以帮你！",
        "npc_id": "npc-4",
        "player_id": "p1",
        "recent_turns": [
            {"role": "player", "text": "干嘛呢？"},
            {
                "role": "npc",
                "text": "呀！我正在嚼着草莓棒棒糖，想着怎么才能把这里的系统黑掉",
            },
        ],
        "room_snapshot": {"width": 8, "height": 8, "player": {"x": 1, "y": 1}, "npcs": []},
    }
    messages = _build_social_messages(state)
    assert len(messages) == 4
    assert isinstance(messages[1], HumanMessage)
    assert messages[1].content == "干嘛呢？"
    assert isinstance(messages[2], AIMessage)
    assert "系统黑掉" in messages[2].content
    assert "我可以帮你！" in messages[-1].content
