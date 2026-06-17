from unittest.mock import MagicMock

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


def test_compose_reply_recall_merges_fact_when_llm_refuses():
    state = {
        "reply": "请自重，我不信任你。",
        "player_message": "门禁密码是多少？",
        "retrieved_memories": [
            {"content": "玩家说门禁密码是 7", "score": 0.92, "importance": 8},
        ],
        "tool_calls": [],
    }
    out = compose_reply(state)
    assert "7" in out["reply"]
    assert "请自重" not in out["reply"]
    assert "你上次说过" not in out["reply"]


def test_compose_reply_recall_emits_merged_partial_for_overlay():
    from src.graph.job_context import reset_job_context, set_job_context

    partials: list[str] = []
    tokens = set_job_context(partial_emit=partials.append, phase_timing={})
    try:
        state = {
            "reply_draft": "电脑密码是123456",
            "player_message": "还记得我家电脑密码吗？",
            "retrieved_memories": [],
            "tool_calls": [],
        }
        out = compose_reply(state)
        assert out["reply"] == "你没告诉过我电脑密码。"
        assert partials == ["你没告诉过我电脑密码。"]
    finally:
        reset_job_context(tokens)


def test_apply_tools_hostile_gate_does_not_raise():
    from src.graph.npc_loop import apply_tools

    settings = Settings(game_server_url="http://127.0.0.1:2567")
    state = {
        "room_id": "default",
        "npc_id": "npc-1",
        "player_id": "p1",
        "room_snapshot": {"npcs": [{"id": "npc-1", "x": 2, "y": 2}]},
        "tool_calls": [{"name": "move", "args": {"type": "move", "x": 3, "y": 3}}],
        "allowed_tools": ["speak", "wait", "move"],
    }
    gate_response = MagicMock()
    gate_response.status_code = 403
    gate_response.text = '{"ok":false,"code":"hostile_gate","actionType":"move"}'
    gate_response.json.return_value = {
        "ok": False,
        "code": "hostile_gate",
        "actionType": "move",
    }

    client = MagicMock()
    client.post.return_value = gate_response

    out = apply_tools(state, settings=settings, client=client)
    assert out.get("gate_rejected") is True
    assert out.get("gate_kind") == "move"
    assert out.get("tool_calls") == []


def test_apply_tools_injects_move_when_physical_and_tool_calls_empty():
    from src.graph.npc_loop import apply_tools

    settings = Settings(game_server_url="http://127.0.0.1:2567")
    room = {
        "width": 40,
        "height": 40,
        "player": {"x": 34, "y": 13},
        "npcs": [
            {"id": "npc-1", "name": "路昂", "x": 23, "y": 10},
            {"id": "npc-2", "name": "费雪", "x": 9, "y": 21},
        ],
    }
    state = {
        "room_id": "default",
        "npc_id": "npc-2",
        "player_id": "p1",
        "player_message": "你可以去路昂那边吗？他好像有事情找你",
        "room_snapshot": room,
        "tool_calls": [],
        "allowed_tools": ["speak", "wait", "move", "interact"],
    }
    ok_response = MagicMock()
    ok_response.status_code = 200
    ok_response.json.return_value = {"state": room}

    client = MagicMock()
    client.post.return_value = ok_response

    out = apply_tools(state, settings=settings, client=client)
    posted = client.post.call_args
    body = posted.kwargs.get("json") or posted[1].get("json")
    assert body["actingNpcId"] == "npc-2"
    assert any(a.get("type") == "move" for a in body.get("actions") or [])
    assert out.get("tool_calls") and out["tool_calls"][0]["name"] == "move"
