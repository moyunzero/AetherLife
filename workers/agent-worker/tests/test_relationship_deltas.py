"""Tests for relationship_deltas engine."""

from __future__ import annotations

from src.council.constants import RELATIONSHIP_DELTA_ABS_MAX
from src.council.relationship_deltas import (
    compute_relationship_deltas,
    filter_linked_edges_for_ui,
    linked_edges_from_deltas,
)


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
        {"npcId": "npc-2", "vote": "no", "reasonZh": "强烈反对"},
    ] + [{"npcId": f"npc-{i}", "vote": "no", "reasonZh": "反对"} for i in range(3, 13)]
    deltas = compute_relationship_deltas([], ballots, "npc-1", seed=7)
    significant = [d for d in deltas if d.get("historyAppend")]
    assert any(abs(d["affectionDelta"]) >= 8 for d in significant)


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


def test_proposer_gets_edge_per_voter():
    """Proposer npc-1 must receive one edge per non-proposer ballot."""
    ballots = [{"npcId": f"npc-{i}", "vote": "no", "reasonZh": "反对"} for i in range(2, 12)]
    ballots.append({"npcId": "npc-12", "vote": "yes", "reasonZh": "赞成"})
    deltas = compute_relationship_deltas([], ballots, "npc-1", seed=42)
    proposer_edges = [
        d for d in deltas if d["npcAId"] == "npc-1" or d["npcBId"] == "npc-1"
    ]
    assert len(proposer_edges) == 11


def test_no_same_camp_mesh_without_debate():
    """10 no / 1 yes with empty transcript → no voter-voter same-side mesh."""
    ballots = [{"npcId": f"npc-{i}", "vote": "no", "reasonZh": "反对"} for i in range(2, 12)]
    ballots.append({"npcId": "npc-12", "vote": "yes", "reasonZh": "赞成"})
    deltas = compute_relationship_deltas([], ballots, "npc-1", seed=99)
    voter_voter = [
        d
        for d in deltas
        if d["npcAId"] != "npc-1"
        and d["npcBId"] != "npc-1"
        and d["npcAId"] != d["npcBId"]
    ]
    assert len(voter_voter) == 0


def test_filter_linked_edges_for_ui_top_k_and_threshold():
    deltas = [
        {"npcAId": "npc-1", "npcBId": "npc-2", "affectionDelta": 12},
        {"npcAId": "npc-1", "npcBId": "npc-3", "affectionDelta": -5},
        {"npcAId": "npc-2", "npcBId": "npc-4", "affectionDelta": -10},
    ]
    ui = filter_linked_edges_for_ui(deltas, top_k=8, min_abs=8)
    assert len(ui) == 2
    assert {"npcAId": "npc-1", "npcBId": "npc-2"} in ui
