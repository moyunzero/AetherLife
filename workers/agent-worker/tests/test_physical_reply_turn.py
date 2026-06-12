from src.graph.nodes.llm_social_turn import _stub_physical_action_turn
from src.graph.state import GraphState


def test_stub_physical_reply_varies_by_npc():
    base: GraphState = {
        "room_id": "default",
        "player_message": "费雪找你有事，你去一趟",
        "player_id": "p1",
    }
    r1 = _stub_physical_action_turn({**base, "npc_id": "npc-1"})
    r3 = _stub_physical_action_turn({**base, "npc_id": "npc-3"})
    assert r1.reply != r3.reply
    assert "好的，我这就去。" not in (r1.reply, r3.reply)
