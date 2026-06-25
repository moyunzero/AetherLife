"""Persona speak-block tests (PERSONA-02, D-SPEAK-01/02)."""

from src.graph.persona import SPEAKABLE_NPC_IDS, build_persona_block


def test_speakable_npc_ids_trio_only():
    assert SPEAKABLE_NPC_IDS == ("npc-1", "npc-2", "npc-3")


def test_npc1_block_contains_display_name_and_order_theme():
    block = build_persona_block("npc-1")
    assert "莫玄虚" in block
    assert "秩序" in block


def test_speakable_trio_blocks_within_800_chars():
    for npc_id in SPEAKABLE_NPC_IDS:
        block = build_persona_block(npc_id)
        assert block, f"{npc_id} should produce non-empty block"
        assert len(block) <= 800, f"{npc_id} block length {len(block)} exceeds 800"


def test_npc4_and_beyond_gated_out():
    assert build_persona_block("npc-4") == ""
    assert build_persona_block("npc-12") == ""
    assert build_persona_block("unknown") == ""


def test_npc1_block_uses_council_name_not_legacy():
    block = build_persona_block("npc-1")
    assert "路昂" not in block
    assert "莫玄虚" in block
