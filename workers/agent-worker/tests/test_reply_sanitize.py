from src.graph.reply_sanitize import sanitize_npc_reply


def test_strips_channel_tokens():
    assert sanitize_npc_reply("好的。<|channel|>thought") == "好的。"


def test_keeps_plain_reply():
    text = "没问题，我这就到你左边去。"
    assert sanitize_npc_reply(text) == text
