"""12-seat persona runtime relationship tests (REL-04, D-VOTE-RAG-05)."""

from __future__ import annotations

import pathlib

from src.council.constants import COUNCIL_NPC_IDS
from src.graph.persona import build_persona_block


def _runtime_edge(
    *,
    npc_a: str,
    npc_b: str,
    affection: int,
    history_summary: str = "",
    current_status: list[str] | None = None,
):
    return {
        "npcAId": npc_a,
        "npcBId": npc_b,
        "affection": affection,
        "historySummary": history_summary,
        "currentStatus": current_status or ["近期争执"],
        "baseTag": "rival",
    }


def test_npc7_block_non_empty():
    block = build_persona_block("npc-7")
    assert block
    assert "纳兰温言" in block


def test_npc11_block_non_empty():
    block = build_persona_block("npc-11")
    assert block
    assert "叶秋水" in block


def test_npc1_still_works():
    block = build_persona_block("npc-1")
    assert "莫玄虚" in block
    assert len(block) <= 800


def test_runtime_relationship_overrides_registry_for_npc7():
    edges = [
        _runtime_edge(
            npc_a="npc-7",
            npc_b="npc-2",
            affection=-42,
            history_summary="近期调解失败，好感骤降",
            current_status=["冷淡"],
        ),
    ]
    block = build_persona_block("npc-7", runtime_relationships=edges)
    assert "affection=-42" in block or "-42" in block
    assert "近期调解失败" in block


def test_runtime_relationship_for_npc11():
    edges = [
        _runtime_edge(
            npc_a="npc-11",
            npc_b="npc-4",
            affection=18,
            history_summary="被糖果恶作剧后仍保持专业距离",
        ),
    ]
    block = build_persona_block("npc-11", runtime_relationships=edges)
    assert "糖果" in block or "npc-4" in block
    assert "恶作剧" in block


def test_runtime_relationship_for_npc12():
    edges = [
        _runtime_edge(
            npc_a="npc-12",
            npc_b="npc-1",
            affection=31,
            history_summary="议事厅辩论后关系回暖",
            current_status=["缓和"],
        ),
    ]
    block = build_persona_block("npc-12", runtime_relationships=edges)
    assert "议事厅辩论后关系回暖" in block
    assert "31" in block


def test_runtime_relationship_registry_fallback_when_no_edges():
    registry_block = build_persona_block("npc-7")
    runtime_block = build_persona_block(
        "npc-7",
        runtime_relationships=[
            _runtime_edge(
                npc_a="npc-7",
                npc_b="npc-3",
                affection=55,
                history_summary="runtime-only edge",
            ),
        ],
    )
    assert registry_block != runtime_block
    assert "runtime-only edge" in runtime_block


def test_all_council_seats_produce_blocks():
    for npc_id in COUNCIL_NPC_IDS:
        block = build_persona_block(npc_id)
        assert block, f"{npc_id} should produce persona block"
        assert len(block) <= 800


def test_no_trio_only_speakable_gate_in_persona_module():
    persona_path = pathlib.Path(__file__).resolve().parents[1] / "src" / "graph" / "persona.py"
    source = persona_path.read_text(encoding="utf-8")
    assert 'SPEAKABLE_NPC_IDS: tuple[str, ...] = ("npc-1", "npc-2", "npc-3")' not in source
