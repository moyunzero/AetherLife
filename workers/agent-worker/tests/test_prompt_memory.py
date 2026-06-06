from src.graph.prompt import format_memory_summary, format_nearby_lore


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
