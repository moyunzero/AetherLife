from app.guards.reply import FALLBACK_REPLY, audit_reply


def test_blocks_state_claim_without_tools():
    assert audit_reply("I opened the door.", []) == FALLBACK_REPLY


def test_allows_with_interact_tool():
    assert audit_reply("I opened the door.", [{"name": "interact"}]) == "I opened the door."


def test_allows_neutral():
    text = "需要我帮你做什么吗？"
    assert audit_reply(text, []) == text


def test_allows_emotional_moved_without_tools():
    reply = "I'm moved that you asked, but I won't say my age."
    assert audit_reply(reply, []) == reply


def test_fallback_is_chat_neutral():
    assert "房间" not in FALLBACK_REPLY
