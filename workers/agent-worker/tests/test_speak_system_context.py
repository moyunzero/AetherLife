"""speak_system_context wires MemoryContext semantic into format_attitude_context."""

from src.graph.speak_system_context import build_speak_system_context


def test_speak_system_context_injects_mood_into_attitude_block():
    text = build_speak_system_context(
        {
            "npc_id": "npc-99",  # non-council → empty persona
            "attitude_band": "warm",
            "effective_score": 22,
            "collective_summaries": [],
            "current_mood": "戏谑",
            "key_beliefs": ["我看穿了他"],
            "attitude_summary": "语气轻松但带刺",
            "room_snapshot": {
                "width": 8,
                "height": 8,
                "player": {"x": 1, "y": 1},
                "npcs": [],
                "objects": [],
            },
        },
        base_prompt="BASE",
    )
    assert "Attitude toward this player:" in text
    assert "mood: 戏谑" in text
    assert "我看穿了他" in text
    assert "语气轻松但带刺" in text


def test_speak_system_context_without_semantic_keeps_band_lines():
    text = build_speak_system_context(
        {
            "npc_id": "npc-99",
            "attitude_band": "neutral",
            "effective_score": 0,
            "collective_summaries": ["窗内事件"],
            "room_snapshot": {
                "width": 8,
                "height": 8,
                "player": {"x": 0, "y": 0},
                "npcs": [],
                "objects": [],
            },
        },
        base_prompt="BASE",
    )
    assert "band: neutral" in text
    assert "窗内事件" in text
    assert "mood:" not in text
