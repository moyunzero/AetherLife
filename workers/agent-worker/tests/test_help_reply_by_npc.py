from src.graph.nodes.llm_social_turn import _deterministic_social_turn
from src.graph.speak_intent import can_use_social_edge_fast_lane


def test_help_fast_lane_reply_varies_by_npc():
    msg = "请帮帮忙"
    _, t1 = can_use_social_edge_fast_lane(msg, npc_id="npc-1")
    _, t2 = can_use_social_edge_fast_lane(msg, npc_id="npc-2")
    assert t1 is not None and t2 is not None
    assert t1.reply != t2.reply
    assert "好的，我会尽力帮忙。" not in (t1.reply, t2.reply)


def test_farm_relay_not_help_fast_lane():
    msg = "诸葛知危那边有农活需要人帮忙，你去不？"
    intent, turn = can_use_social_edge_fast_lane(msg, npc_id="npc-2")
    assert turn is None
    assert intent.value == "physical"
