from src.graph.action_sanitize import normalize_tool_call_to_action, tool_calls_to_actions

ROOM = {
    "width": 8,
    "height": 8,
    "objects": [{"id": "door-1", "kind": "door", "x": 3, "y": 3}],
    "npcs": [{"id": "npc-1"}, {"id": "npc-2"}],
}


def test_strips_extra_keys_on_move():
    call = {
        "name": "move",
        "args": {"type": "move", "x": 6, "y": 5, "reason": "below player"},
    }
    assert normalize_tool_call_to_action(call, room=ROOM) == {
        "type": "move",
        "x": 6,
        "y": 5,
    }


def test_move_aliases_target_xy():
    call = {"name": "move", "args": {"targetX": 4, "targetY": 6}}
    assert normalize_tool_call_to_action(call, room=ROOM) == {
        "type": "move",
        "x": 4,
        "y": 6,
    }


def test_skips_unknown_object_interact():
    call = {"name": "interact", "args": {"type": "interact", "objectId": "door-2"}}
    assert normalize_tool_call_to_action(call, room=ROOM) is None


def test_keeps_valid_interact():
    call = {"name": "interact", "args": {"objectId": "door-1"}}
    assert normalize_tool_call_to_action(call, room=ROOM) == {
        "type": "interact",
        "objectId": "door-1",
    }


def test_batch_keeps_move_drops_bad_interact():
    calls = [
        {"name": "move", "args": {"x": 6, "y": 6, "note": "snap"}},
        {"name": "interact", "args": {"objectId": "door-2"}},
    ]
    assert tool_calls_to_actions(calls, room=ROOM) == [{"type": "move", "x": 6, "y": 6}]
