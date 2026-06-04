from app.guards.reply import FALLBACK_REPLY, audit_reply


def test_blocks_state_claim_without_tools():
    assert audit_reply("I opened the door.", []) == FALLBACK_REPLY


def test_allows_with_interact_tool():
    assert audit_reply("I opened the door.", [{"name": "interact"}]) == "I opened the door."


def test_allows_neutral():
    text = "需要我帮你做什么吗？"
    assert audit_reply(text, []) == text
