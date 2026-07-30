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


def test_audit_allows_chat_age_question_style_replies():
    """Pure dialogue must not be replaced by room-interact fallback (false positives)."""
    samples = [
        "问年龄不太礼貌吧，我可不轻易说。",
        "I'm moved that you asked, but a lady never tells.",
        "I've left that number behind me.",
        "我现在就去告诉你？不，保密。",
        "别乱问，我走向你是为了聊天不是受审。",
    ]
    for reply in samples:
        assert audit_reply(reply, []) == reply, reply


def test_fallback_reply_is_chat_neutral():
    assert "房间" not in FALLBACK_REPLY
