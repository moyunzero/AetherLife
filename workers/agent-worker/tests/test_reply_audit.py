from src.guard.reply_audit import FALLBACK_REPLY, audit_reply


def test_audit_passes_when_state_changing_tools_present():
    assert audit_reply("I opened the door.", [{"name": "interact"}]) == "I opened the door."


def test_audit_blocks_speak_only_with_state_claim():
    assert audit_reply("我现在就去把门打开。", [{"name": "speak", "args": {}}]) == FALLBACK_REPLY


def test_audit_blocks_claim_without_tools():
    assert audit_reply("I moved to the door and opened it.", []) == FALLBACK_REPLY


def test_audit_allows_neutral_reply():
    assert audit_reply("Tell me more about what you want.", []) == "Tell me more about what you want."


def test_audit_allows_greeting():
    reply = "我很好，谢谢你的关心！需要我帮你做什么吗？"
    assert audit_reply(reply, []) == reply


def test_audit_blocks_chinese_immediate_action_without_tools():
    assert audit_reply("我现在就去把门打开。", []) == FALLBACK_REPLY
