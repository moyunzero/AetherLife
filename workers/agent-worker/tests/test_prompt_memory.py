from src.graph.prompt import format_attitude_context, format_memory_summary, format_nearby_lore
from src.graph.prompt import build_turn_messages


def test_format_attitude_context_includes_band():
    text = format_attitude_context(
        band="hostile",
        effective_score=-35,
        summaries=["玩家多次不敬"],
    )
    assert "hostile" in text
    assert "敌意" in text
    assert "-35" in text
    assert "玩家多次不敬" in text


def test_build_turn_messages_includes_attitude_block():
    messages = build_turn_messages(
        {
            "player_message": "hello",
            "attitude_band": "wary",
            "effective_score": -5,
            "collective_summaries": [],
            "room_snapshot": {"width": 8, "height": 8, "player": {"x": 1, "y": 1}},
        }
    )
    system = messages[0].content
    assert "Attitude toward this player" in system
    assert "wary" in system


def test_format_memory_summary_three_sections():
    text = format_memory_summary(
        latest_bulk="old events",
        latest_reflection="recent mood",
        retrieved=[{"text": "player: FACT-XYZ-42", "score": 0.91, "importance": 8}],
    )
    assert "Bulk summary:" in text
    assert "Reflection:" in text
    assert "Retrieved memories:" in text
    assert "FACT-XYZ-42" in text
    assert "old events" in text
    assert "recent mood" in text


def test_format_nearby_lore_bullets():
    text = format_nearby_lore(
        {
            "nearbyLore": [
                {"cx": 0, "cy": 0, "nameZh": "晨曦村", "flavorOneLine": "起点"},
                {"cx": 1, "cy": 0, "nameZh": "风息浅滩", "flavorOneLine": "露水"},
            ]
        }
    )
    assert "邻近地块叙事" in text
    assert "晨曦村" in text
    assert "风息浅滩" in text


def test_format_nearby_lore_empty():
    assert format_nearby_lore({}) == ""
