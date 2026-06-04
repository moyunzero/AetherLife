from src.graph.action_intent import (
    build_tool_retry_message,
    has_state_changing_tool,
    player_requests_interact,
    player_requests_move,
    player_requests_physical_action,
)


def test_player_requests_move():
    assert player_requests_move("移动到 (5,5)")
    assert player_requests_move("go to 3,3")
    assert not player_requests_move("你好吗？")


def test_player_requests_interact():
    assert player_requests_interact("打开门")
    assert player_requests_interact("open the door")
    assert not player_requests_interact("你好")


def test_player_requests_physical_action():
    assert player_requests_physical_action("移动到 (10,15)")
    assert player_requests_physical_action("打开门")


def test_has_state_changing_tool():
    assert has_state_changing_tool([{"name": "move", "args": {}}])
    assert has_state_changing_tool([{"name": "interact", "args": {}}])
    assert not has_state_changing_tool([{"name": "speak", "args": {}}])
    assert not has_state_changing_tool([])


def test_build_tool_retry_message_includes_bounds_and_door():
    msg = build_tool_retry_message({"width": 8, "height": 8, "objects": [{"id": "door-1", "kind": "door", "x": 3, "y": 3, "state": "closed"}]})
    assert "0 到 7" in msg
    assert "door-1" in msg
    assert "interact" in msg
