"""Persona speak-block tests (PERSONA-02, D-SPEAK-01/02)."""

from src.council.constants import COUNCIL_NPC_IDS
from src.graph.nodes.llm_social_turn import _build_social_messages
from src.graph.persona import build_persona_block
from src.graph.prompt import build_turn_messages
from src.graph.state import GraphState

_MINIMAL_ROOM = {
    "width": 8,
    "height": 8,
    "player": {"x": 1, "y": 1},
    "npcs": [],
}


def _base_state(**overrides) -> GraphState:
    state: GraphState = {
        "room_id": "default",
        "player_message": "你好",
        "npc_id": "npc-1",
        "player_id": "p1",
        "room_snapshot": _MINIMAL_ROOM,
    }
    state.update(overrides)
    return state


def test_council_npc_ids_cover_twelve_seats():
    assert COUNCIL_NPC_IDS == tuple(f"npc-{i}" for i in range(1, 13))


def test_npc1_block_contains_display_name_and_order_theme():
    block = build_persona_block("npc-1")
    assert "莫玄虚" in block
    assert "秩序" in block


def test_all_council_blocks_within_800_chars():
    for npc_id in COUNCIL_NPC_IDS:
        block = build_persona_block(npc_id)
        assert block, f"{npc_id} should produce non-empty block"
        assert len(block) <= 800, f"{npc_id} block length {len(block)} exceeds 800"


def test_unknown_npc_returns_empty():
    assert build_persona_block("unknown") == ""


def test_npc1_block_uses_council_name_not_legacy():
    block = build_persona_block("npc-1")
    assert "路昂" not in block
    assert "莫玄虚" in block


def test_social_messages_inject_persona_for_npc1():
    messages = _build_social_messages(_base_state(npc_id="npc-1"))
    system = messages[0].content
    assert "莫玄虚" in system
    assert system.index("莫玄虚") < system.index("房间网格")


def test_social_messages_inject_persona_for_npc7():
    messages = _build_social_messages(_base_state(npc_id="npc-7"))
    system = messages[0].content
    assert "纳兰温言" in system


def test_turn_messages_inject_persona_before_memory():
    state = _base_state(npc_id="npc-2", memory_summary="Bulk summary:\nfoo")
    messages = build_turn_messages(state)
    system = messages[0].content
    assert "阿斯托利亚" in system
    assert system.index("阿斯托利亚") < system.index("Memory summary:")


def test_turn_messages_inject_persona_for_npc5():
    messages = build_turn_messages(_base_state(npc_id="npc-5"))
    system = messages[0].content
    assert "白星烬" in system
