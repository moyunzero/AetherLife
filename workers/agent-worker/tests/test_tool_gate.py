from src.config import Settings
from src.graph.npc_loop import (
    _filter_tool_calls,
    compose_reply,
    llm_turn,
)
from src.memory.client import parse_collective_from_context


def test_parse_collective_from_context():
    parsed = parse_collective_from_context(
        {
            "collective": {
                "band": "hostile",
                "effectiveScore": -42,
                "allowedTools": ["speak", "wait"],
                "recentSummaries": ["多人言语冲突"],
            }
        }
    )
    assert parsed["attitude_band"] == "hostile"
    assert parsed["effective_score"] == -42
    assert parsed["allowed_tools"] == ["speak", "wait"]
    assert parsed["collective_summaries"] == ["多人言语冲突"]


def test_filter_tool_calls_strips_move_for_hostile():
    raw = [
        {"name": "move", "args": {"type": "move", "x": 1, "y": 1}},
        {"name": "speak", "args": {"type": "speak", "text": "hi"}},
    ]
    filtered, rejected = _filter_tool_calls(raw, {"speak", "wait"})
    assert rejected is True
    assert filtered == [{"name": "speak", "args": {"type": "speak", "text": "hi"}}]


def test_llm_turn_mock_hostile_filters_move(monkeypatch):
    monkeypatch.setenv("LLM_MOCK", "1")
    state = {
        "room_id": "r1",
        "player_message": "move north",
        "room_snapshot": {
            "width": 8,
            "height": 8,
            "player": {"x": 2, "y": 2},
            "npcs": [{"id": "npc-1", "x": 2, "y": 2}],
        },
        "allowed_tools": ["speak", "wait"],
    }
    out = llm_turn(state, settings=Settings(llm_mock=True))
    assert out.get("gate_rejected") is True
    assert all(call.get("name") in {"speak", "wait"} for call in out.get("tool_calls") or [])


def test_compose_reply_adds_gate_hint():
    state = {"reply": "好的。", "gate_rejected": True, "tool_calls": []}
    out = compose_reply(state)
    assert "当前关系较紧张" in out["reply"]


def test_compose_reply_hostile_move_without_move_tool():
    from src.graph.npc_loop import _finalize_hostile_gate

    state = {
        "attitude_band": "hostile",
        "player_message": "你移动到我的下方",
        "tool_calls": [{"name": "wait", "args": {}}],
        "reply": "我还不能确定能否那样做",
        "gate_rejected": False,
    }
    finalized = _finalize_hostile_gate(state)
    assert finalized["gate_rejected"] is True
    assert finalized.get("gate_kind") == "move"
    out = compose_reply(state)
    assert out["gate_rejected"] is True
    assert "当前关系较紧张" in out["reply"]
