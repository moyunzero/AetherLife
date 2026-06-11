from src.graph.nodes.llm_social_turn import _pick_casual_reply, preview_casual_stub


def test_pick_casual_reply_greeting_stable():
    a = _pick_casual_reply("你好")
    b = _pick_casual_reply("你好")
    assert a == b
    assert len(a) > 0


def test_pick_casual_reply_meta_brief_stable():
    msg = "你好，用一句话简短回复"
    a = _pick_casual_reply(msg)
    b = _pick_casual_reply(msg)
    assert a == b
    assert len(a) > 0


def test_preview_casual_stub_b1():
    stub = preview_casual_stub("你好，用一句话简短回复", speak_intent="casual")
    assert stub
    assert stub == _pick_casual_reply("你好，用一句话简短回复")


def test_preview_casual_stub_narrative_none():
    assert preview_casual_stub("故宫在哪里，给我讲讲历史", speak_intent="narrative") is None
