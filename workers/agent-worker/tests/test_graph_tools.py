from src.graph.prompt import build_turn_messages
from src.graph.tools import load_tools_for_binding, normalize_tool_definition, reply_from_turn


def test_normalize_tool_definition_flattens_definitions():
    raw = {
        "type": "function",
        "function": {
            "name": "move",
            "description": "Move",
            "parameters": {
                "type": "object",
                "properties": {
                    "$ref": "#/definitions/move",
                    "definitions": {
                        "move": {
                            "type": "object",
                            "properties": {
                                "type": {"const": "move"},
                                "x": {"type": "number"},
                                "y": {"type": "number"},
                            },
                            "required": ["type", "x", "y"],
                        }
                    },
                },
            },
        },
    }
    normalized = normalize_tool_definition(raw)
    props = normalized["function"]["parameters"]["properties"]
    assert "x" in props
    assert "y" in props


def test_load_tools_for_binding_has_core_four():
    tools = load_tools_for_binding()
    names = {tool["function"]["name"] for tool in tools}
    assert names == {"move", "interact", "speak", "wait"}
    for tool in tools:
        assert tool["function"]["parameters"].get("type") == "object"


def test_build_turn_messages_includes_player_text_and_room_bounds():
    messages = build_turn_messages(
        {
            "room_id": "default",
            "player_message": "你好吗？",
            "room_snapshot": {"width": 8, "height": 8, "npc": {"name": "Ava"}, "objects": []},
        }
    )
    assert len(messages) == 2
    assert "你好吗？" in messages[1].content
    assert "直接回应玩家" in messages[0].content
    assert "x∈[0,7]" in messages[0].content


def test_reply_from_turn_prefers_speak_tool_content():
    class Msg:
        content = "ignored"

    tool_calls = [{"name": "speak", "args": {"type": "speak", "targetId": "player", "content": "我很好！"}}]
    assert reply_from_turn(Msg(), tool_calls) == "我很好！"
