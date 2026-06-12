from src.graph.action_intent import (
    align_move_tool_to_explicit_coords,
    align_move_tool_to_intended_target,
    build_dialogue_context,
    build_tool_retry_message,
    has_state_changing_tool,
    inject_relative_move_tool,
    player_requests_interact,
    player_requests_move,
    player_requests_physical_action,
    resolve_explicit_move_cell,
    resolve_injected_move_cell,
    resolve_npc_relative_move_cell,
    resolve_npc_snap_anchor_cell,
    resolve_relative_move_cell,
)


def test_player_requests_move():
    assert player_requests_move("移动到 (5,5)")
    assert player_requests_move("go to 3,3")
    assert player_requests_move("你来我的左侧")
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


def test_resolve_relative_move_cell_below_and_right():
    room = {"width": 8, "height": 8, "player": {"x": 4, "y": 5}}
    assert resolve_relative_move_cell("移动到我的下方", room) == (4, 6)
    assert resolve_relative_move_cell("移动到我的右侧", room) == (5, 5)
    assert resolve_relative_move_cell("移动到 (6,6)", room) is None


def test_resolve_npc_relative_move_cell_feixue_nearby():
    room = {
        "width": 40,
        "height": 40,
        "player": {"x": 34, "y": 13},
        "npcs": [
            {"id": "npc-1", "name": "路昂", "x": 23, "y": 10},
            {"id": "npc-2", "name": "费雪", "x": 9, "y": 21},
        ],
    }
    assert resolve_npc_relative_move_cell("去费雪附近", room) == (9, 21)
    assert resolve_npc_snap_anchor_cell("去费雪附近", room) == (9, 21)


def test_pronoun_resolves_npc_from_dialogue_context():
    room = {
        "width": 40,
        "height": 40,
        "player": {"x": 20, "y": 13},
        "npcs": [
            {"id": "npc-1", "name": "路昂", "x": 23, "y": 10},
            {"id": "npc-2", "name": "费雪", "x": 9, "y": 21},
        ],
    }
    ctx = build_dialogue_context(
        "她找你，你需要去她旁边",
        [{"role": "player", "text": "费雪找你"}],
    )
    assert resolve_npc_relative_move_cell("她找你，你需要去她旁边", room, ctx) == (9, 21)
    assert resolve_npc_snap_anchor_cell("她找你，你需要去她旁边", room, ctx) == (9, 21)


def test_player_requests_move_typo_pangbai():
    assert player_requests_move("费雪找你，去费雪旁白吧")
    assert player_requests_physical_action("费雪找你，去费雪旁白吧")


def test_resolve_npc_relative_move_cell_feixue_below():
    room = {
        "width": 40,
        "height": 40,
        "player": {"x": 34, "y": 13},
        "npcs": [
            {"id": "npc-1", "name": "路昂", "x": 23, "y": 10},
            {"id": "npc-2", "name": "费雪", "x": 9, "y": 21},
        ],
    }
    assert resolve_npc_relative_move_cell("费雪找你，去她下方好吗？", room) == (9, 22)
    assert resolve_npc_relative_move_cell("去费雪下面", room) == (9, 22)
    assert resolve_npc_relative_move_cell("移动到我的下方", room) is None


def test_align_move_tool_overrides_llm_one_step_to_npc_relative():
    room = {
        "width": 40,
        "height": 40,
        "player": {"x": 34, "y": 13},
        "npcs": [
            {"id": "npc-1", "name": "路昂", "x": 23, "y": 10},
            {"id": "npc-2", "name": "费雪", "x": 9, "y": 21},
        ],
    }
    calls = align_move_tool_to_intended_target(
        [{"name": "move", "args": {"type": "move", "x": 24, "y": 11}}],
        player_message="费雪找你，去她下方好吗？",
        room=room,
    )
    assert calls[0]["args"]["x"] == 9
    assert calls[0]["args"]["y"] == 22


def test_inject_npc_relative_fast_path_without_llm():
    room = {
        "width": 40,
        "height": 40,
        "player": {"x": 34, "y": 13},
        "npcs": [
            {"id": "npc-1", "name": "路昂", "x": 23, "y": 10},
            {"id": "npc-2", "name": "费雪", "x": 9, "y": 21},
        ],
    }
    calls = inject_relative_move_tool(
        [],
        player_message="费雪找你，去她下方好吗？",
        room=room,
    )
    assert calls[0]["name"] == "move"
    assert calls[0]["args"]["x"] == 9
    assert calls[0]["args"]["y"] == 22


def test_resolve_explicit_move_cell():
    room = {"width": 40, "height": 40, "player": {"x": 4, "y": 5}}
    assert resolve_explicit_move_cell("去费雪下面 (9,20)", room) == (9, 20)
    assert resolve_explicit_move_cell("移动到 (6,6)", room) == (6, 6)


def test_align_move_tool_overrides_llm_one_step():
    room = {"width": 40, "height": 40, "player": {"x": 4, "y": 5}}
    calls = align_move_tool_to_explicit_coords(
        [{"name": "move", "args": {"type": "move", "x": 24, "y": 11}}],
        player_message="请到 (9,20)",
        room=room,
    )
    assert calls[0]["args"]["x"] == 9
    assert calls[0]["args"]["y"] == 20


def test_inject_explicit_move_when_llm_omits_tool():
    room = {"width": 40, "height": 40, "player": {"x": 4, "y": 5}}
    calls = inject_relative_move_tool(
        [{"name": "speak", "args": {"content": "好的"}}],
        player_message="去 (9,20)",
        room=room,
    )
    assert calls[0]["name"] == "move"
    assert calls[0]["args"] == {"type": "move", "x": 9, "y": 20}


def test_inject_relative_move_when_llm_omits_tool():
    room = {"width": 8, "height": 8, "player": {"x": 4, "y": 5}}
    calls = inject_relative_move_tool(
        [{"name": "speak", "args": {"content": "好的"}}],
        player_message="移动到我的右边",
        room=room,
    )
    assert calls[0]["name"] == "move"
    assert calls[0]["args"] == {"type": "move", "x": 5, "y": 5}


def test_build_tool_retry_message_includes_bounds_and_door():
    msg = build_tool_retry_message({"width": 8, "height": 8, "objects": [{"id": "door-1", "kind": "door", "x": 3, "y": 3, "state": "closed"}]})
    assert "0 到 7" in msg
    assert "door-1" in msg
    assert "interact" in msg


def test_relay_summon_phrases_from_uat():
    """UAT: «费雪找你有事，来这边一趟» — NPC 口头答应但未移动 (ISSUE relay summon)."""
    from src.graph.speak_intent import classify_speak_intent, SpeakIntent

    room = {
        "width": 40,
        "height": 40,
        "player": {"x": 34, "y": 13},
        "npcs": [
            {"id": "npc-1", "name": "路昂", "x": 23, "y": 10},
            {"id": "npc-2", "name": "费雪", "x": 9, "y": 21},
            {"id": "npc-3", "name": "南宫婉", "x": 15, "y": 8},
        ],
    }
    for msg in ("费雪找你有事，来这边一趟", "费雪找你有事，你来不"):
        assert player_requests_move(msg), msg
        assert classify_speak_intent(msg) == SpeakIntent.PHYSICAL, msg
        calls = inject_relative_move_tool([], player_message=msg, room=room)
        assert calls and calls[0]["name"] == "move", msg
        assert calls[0]["args"]["x"] == 34 and calls[0]["args"]["y"] == 13, msg

    farm_relay = "南宫婉那边有农活需要人帮忙，你去不？"
    assert player_requests_move(farm_relay)
    assert classify_speak_intent(farm_relay) == SpeakIntent.PHYSICAL
    farm_calls = inject_relative_move_tool([], player_message=farm_relay, room=room)
    assert farm_calls[0]["args"]["x"] == 15 and farm_calls[0]["args"]["y"] == 8

    relay_only = inject_relative_move_tool(
        [],
        player_message="费雪找你有事，去她那边",
        room=room,
    )
    assert relay_only[0]["args"]["x"] == 9 and relay_only[0]["args"]["y"] == 21
