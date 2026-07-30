"""D-BELIEF-05/06: attitude block semantic lines; mood never lifts tools."""

from src.collective.scoring import allowed_tools_for_band
from src.graph.prompt import format_attitude_context
from src.memory.client import parse_collective_from_context


def test_format_attitude_context_appends_mood_beliefs_summary():
    text = format_attitude_context(
        band="warm",
        effective_score=25,
        summaries=["近期互助"],
        mood="恼火",
        beliefs=["我不信他的承诺"],
        summary="玩家曾失信一次",
    )
    assert "Attitude toward this player:" in text
    assert "band: warm" in text
    assert "mood: 恼火" in text
    assert "我不信他的承诺" in text
    assert "玩家曾失信一次" in text


def test_format_attitude_context_absent_semantic_unchanged():
    baseline = format_attitude_context(
        band="neutral",
        effective_score=0,
        summaries=["a"],
    )
    with_empty = format_attitude_context(
        band="neutral",
        effective_score=0,
        summaries=["a"],
        mood=None,
        beliefs=None,
        summary=None,
    )
    assert baseline == with_empty
    assert "mood:" not in baseline


def test_mood_does_not_change_allowed_tools_for_band():
    band = "warm"
    tools_calm = allowed_tools_for_band(band)
    tools_angry = allowed_tools_for_band(band)
    assert tools_calm == tools_angry

    parsed_a = parse_collective_from_context(
        {
            "collective": {
                "band": band,
                "effectiveScore": 30,
                "currentMood": "平静",
                "keyBeliefs": [],
                "summary": "",
            }
        }
    )
    parsed_b = parse_collective_from_context(
        {
            "collective": {
                "band": band,
                "effectiveScore": 30,
                "currentMood": "恼火",
                "keyBeliefs": ["我不信他"],
                "summary": "紧张",
            }
        }
    )
    assert parsed_a["allowed_tools"] == parsed_b["allowed_tools"]
    assert parsed_a["current_mood"] == "平静"
    assert parsed_b["current_mood"] == "恼火"
    assert parsed_b["key_beliefs"] == ["我不信他"]
    assert parsed_b["attitude_summary"] == "紧张"
