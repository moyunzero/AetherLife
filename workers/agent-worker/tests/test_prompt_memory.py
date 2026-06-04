from src.graph.prompt import format_memory_summary


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
