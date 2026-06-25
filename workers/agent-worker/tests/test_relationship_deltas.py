"""Tests for relationship_deltas engine."""

from __future__ import annotations

from src.council.constants import RELATIONSHIP_DELTA_ABS_MAX
from src.council.relationship_deltas import compute_relationship_deltas, linked_edges_from_deltas


def test_delta_clamp():
    transcript = [
        {"npcId": "npc-1", "text": "我赞成此议", "round": 1},
        {"npcId": "npc-2", "text": "我反对，太荒唐", "round": 1},
    ]
    ballots = [
        {"npcId": "npc-2", "vote": "yes", "reasonZh": "赞成"},
        {"npcId": "npc-3", "vote": "no", "reasonZh": "反对"},
    ] + [{"npcId": f"npc-{i}", "vote": "yes", "reasonZh": "y"} for i in range(4, 13)]
    deltas = compute_relationship_deltas(transcript, ballots, "npc-1", seed=42)
    for d in deltas:
        assert abs(d["affectionDelta"]) <= RELATIONSHIP_DELTA_ABS_MAX


def test_linked_edges_on_opposing_votes():
    ballots = [
        {"npcId": "npc-2", "vote": "yes", "reasonZh": "赞成"},
        {"npcId": "npc-3", "vote": "no", "reasonZh": "反对"},
        {"npcId": "npc-4", "vote": "yes", "reasonZh": "赞成"},
    ] + [{"npcId": f"npc-{i}", "vote": "no", "reasonZh": "反对"} for i in range(5, 13)]
    deltas = compute_relationship_deltas([], ballots, "npc-1", seed=99)
    edges = linked_edges_from_deltas(deltas)
    assert len(edges) >= 1


def test_history_append_on_significant_delta():
    ballots = [
        {"npcId": "npc-2", "vote": "yes", "reasonZh": "赞成"},
        {"npcId": "npc-3", "vote": "no", "reasonZh": "强烈反对"},
    ] + [{"npcId": f"npc-{i}", "vote": "no" if i % 2 else "yes", "reasonZh": "x"} for i in range(4, 13)]
    deltas = compute_relationship_deltas([], ballots, "npc-1", seed=7)
    significant = [d for d in deltas if d.get("historyAppend")]
    assert any(abs(d["affectionDelta"]) >= 8 for d in significant) or len(deltas) == 0


def test_prompt_builder_includes_npc7_sample():
    from src.council.relationship_prompt import format_relationship_block_for_npc

    edges = [
        {
            "npcAId": "npc-4",
            "npcBId": "npc-7",
            "affection": -20,
            "baseTag": "cautious",
            "currentStatus": ["tension"],
            "historySummary": "辩论中针锋相对",
        },
        {
            "npcAId": "npc-1",
            "npcBId": "npc-7",
            "affection": 40,
            "baseTag": "mediate_respect",
            "currentStatus": ["mutual_respect"],
            "historySummary": "多次调解",
        },
    ]
    block = format_relationship_block_for_npc("npc-7", edges)
    assert "npc-7" in block or "纳兰温言" in block
    assert "npc-4" in block or "npc-1" in block
