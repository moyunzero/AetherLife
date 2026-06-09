from src.graph.recall_merge import (
    extract_password_answer,
    is_recall_question,
    merge_recall_into_reply,
    reply_refuses_recall,
)


def test_is_recall_question():
    assert is_recall_question("我之前说的 FACT-X 门禁密码是多少？")
    assert not is_recall_question("移动到我的下方")


def test_merge_recall_replaces_refusal_with_fact():
    retrieved = [{"text": "player: 请记住 FACT-MANUAL 门禁密码是 7", "score": 0.9}]
    out = merge_recall_into_reply(
        "我之前说的 FACT-MANUAL 门禁密码是多少？",
        "请自重，我不会向不信任的人透露信息。",
        retrieved,
    )
    assert "7" in out
    assert "你上次" not in out
    assert reply_refuses_recall(out) is False


def test_merge_recall_skips_when_reply_already_has_answer():
    retrieved = [{"text": "player: 门禁密码是 7", "score": 0.88}]
    original = "门禁密码是 7，还有别的事吗？"
    out = merge_recall_into_reply(
        "门禁密码是多少？",
        original,
        retrieved,
    )
    assert out == original


def test_extract_password_answer():
    assert extract_password_answer("请记住 FACT 门禁密码是 7") == "7"
