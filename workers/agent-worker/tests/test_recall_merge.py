from src.graph.recall_merge import (
    augment_retrieved_with_dialogue_turns,
    extract_food_preference,
    extract_nickname,
    extract_password_answer,
    extract_read_preference,
    is_recall_question,
    merge_recall_into_reply,
    pick_recall_memory,
    reply_refuses_recall,
)


def test_is_recall_question():
    assert is_recall_question("我之前说的 FACT-X 门禁密码是多少？")
    assert is_recall_question("我叫什么？")
    assert is_recall_question("你记得我刚才说的密码吗")
    assert not is_recall_question("移动到我的下方")
    assert not is_recall_question("我告诉你一个秘密，我的家里门锁密码是111")
    assert not is_recall_question("请记住 sunset42 门禁密码是 7")
    assert not is_recall_question("我叫墨韵，请记住~")


def test_seed_disclosure_not_merged_with_stale_password_memory():
    seed = "我告诉你一个秘密，我的家里门锁密码是111"
    assert not is_recall_question(seed)
    stale = [{"text": "player: 你的门锁密码是 666，我记住了。", "score": 0.95}]
    assert merge_recall_into_reply(seed, "好的，我记住了。", stale) == "好的，我记住了。"


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


def test_merge_recall_fixes_fact_token_echo_without_password():
    """LLM echoing FACT token from the question must not block deterministic merge."""
    retrieved = [{"text": "player: 请记住 FACT-MANUAL 门禁密码是 7", "score": 0.9}]
    wrong = "你之前提到的 FACT-MANUAL 门禁密码是 FACT-MANUAL。"
    out = merge_recall_into_reply(
        "我之前说的 FACT-MANUAL 门禁密码是多少？",
        wrong,
        retrieved,
    )
    assert "门禁密码是 7" in out


def test_extract_password_answer():
    assert extract_password_answer("请记住 FACT 门禁密码是 7") == "7"
    assert extract_password_answer("请记住我家电脑密码是 111") == "111"
    assert extract_password_answer("我告诉你我家门禁密码：08080") == "08080"
    assert extract_password_answer("player: 我告诉你我家门禁密码：08080") == "08080"
    assert extract_password_answer("还记得我家电脑密码吗？") is None
    assert extract_password_answer("player: 还记得我家电脑密码吗？") is None


def test_pick_recall_password_colon_disclosure_seed():
    seed = {"text": "player: 我告诉你我家门禁密码：08080", "score": 0.96}
    picked = pick_recall_memory("我家门禁密码是多少？", [seed])
    assert picked is not None
    assert extract_password_answer(picked["text"]) == "08080"


def test_pick_recall_drink_and_read_preferences():
    tea = {"text": "player: 请记住我喜欢喝茶验ABC茶", "score": 0.9}
    book = {"text": "player: 请记住我喜欢看书验XYZ书", "score": 0.88}
    picked_tea = pick_recall_memory("我喜欢喝什么茶？", [tea])
    assert picked_tea is not None
    assert "茶验ABC" in extract_food_preference(picked_tea["text"])
    picked_book = pick_recall_memory("我喜欢看什么书？", [book])
    assert picked_book is not None
    assert "书验XYZ" in extract_read_preference(picked_book["text"])
    out_tea = merge_recall_into_reply(
        "我喜欢喝什么茶？",
        "我不清楚。",
        [tea],
    )
    assert "茶验ABC" in out_tea


def test_extract_nickname_rejects_recall_question_row():
    assert extract_nickname("请记住我叫小明") == "小明"
    assert extract_nickname("player: 请记住我叫小明") == "小明"
    assert extract_nickname("我叫什么？") is None
    assert extract_nickname("player: 我叫什么？") is None


def test_pick_recall_nickname_rejects_question_row():
    bad_row = [{"text": "player: 我叫什么？", "score": 0.95}]
    assert pick_recall_memory("我叫什么？", bad_row) is None


def test_merge_recall_rejects_recall_question_as_password_memory():
    """Embed must not treat the recall question itself as a password fact."""
    bad_row = [{"text": "player: 还记得我家电脑密码吗？", "score": 0.95}]
    assert pick_recall_memory("还记得我家电脑密码吗？", bad_row) is None
    out = merge_recall_into_reply("还记得我家电脑密码吗？", "电脑密码是123456", bad_row)
    assert "123456" not in out
    assert "吗" not in out
    assert "没" in out


def test_merge_recall_nickname_replaces_refusal_solo01():
    """SOLO-01: nickname recall beyond password/FACT-token path."""
    retrieved = [{"text": "player: 请记住我叫小明", "score": 0.9}]
    out = merge_recall_into_reply(
        "我叫什么？",
        "请自重，我不会向不信任的人透露信息。",
        retrieved,
    )
    assert "小明" in out
    assert "你上次" not in out
    assert reply_refuses_recall(out) is False


def test_extract_food_preference():
    assert extract_food_preference("告诉你一个秘密，我喜欢吃芒果～") == "芒果"
    assert extract_food_preference("player: 告诉你一个秘密，我喜欢吃芒果～") == "芒果"
    assert extract_food_preference("player: 我喜欢吃西瓜，你喜欢吃什么？") == "西瓜"
    assert extract_food_preference("player: 我喜欢吃芒果布丁，你喜欢吃什么？") == "芒果布丁"
    assert extract_food_preference("你还记得我喜欢吃什么吗？") is None
    assert extract_food_preference("npc: 你没告诉过我你喜欢吃什么。") is None


def test_merge_recall_mango_over_watermelon_with_dialogue_turns():
    """Mango disclosed in-session but not yet in DB — dialogue turns must win."""
    db_augmented = [
        {"text": "player: 你还记得我喜欢吃什么吗？", "score": 0.96, "recencyRank": 0},
        {"text": "npc: 你没告诉过我你喜欢吃什么。", "score": 0.95, "recencyRank": 1},
        {"text": "player: 我喜欢吃西瓜，你喜欢吃什么？", "score": 0.72, "recencyRank": 4},
    ]
    recent_turns = [
        {"role": "player", "text": "我喜欢吃西瓜，你喜欢吃什么？"},
        {"role": "npc", "text": "西瓜清甜多汁，确实是夏日佳品。"},
        {"role": "player", "text": "我喜欢吃芒果布丁，你喜欢吃什么？"},
        {"role": "npc", "text": "芒果布丁听起来很美味。"},
    ]
    retrieved = augment_retrieved_with_dialogue_turns(db_augmented, recent_turns)
    out = merge_recall_into_reply(
        "你还记得我喜欢吃什么吗？",
        "你喜欢吃西瓜",
        retrieved,
    )
    assert "芒果布丁" in out
    assert "西瓜" not in out


def test_merge_recall_watermelon_uat_realistic():
    """Embed ranks prior recall rows above disclosure; pick must still find 西瓜."""
    retrieved = [
        {"text": "player: 你还记得我喜欢吃什么吗？", "score": 0.96, "recencyRank": 0},
        {"text": "npc: 抱歉，我不记得你喜欢吃什么。", "score": 0.95, "recencyRank": 1},
        {"text": "player: 我喜欢吃西瓜，你喜欢吃什么？", "score": 0.72, "recencyRank": 2},
        {"text": "npc: 西瓜清甜多汁，确实是夏日佳品。", "score": 0.71, "recencyRank": 3},
    ]
    out = merge_recall_into_reply(
        "你还记得我喜欢吃什么吗？",
        "你没告诉过我你喜欢吃什么。",
        retrieved,
    )
    assert "西瓜" in out
    assert "没告诉" not in out


def test_merge_recall_food_preference_uat():
    """UAT: disclose mango then ask 喜欢吃什么 — must not fall back to 没有印象."""
    retrieved = [{"text": "player: 告诉你一个秘密，我喜欢吃芒果～", "score": 0.88}]
    out = merge_recall_into_reply(
        "你还记得我喜欢吃什么吗？",
        "你喜欢吃的东西我还记得，具体来说是……",
        retrieved,
    )
    assert "芒果" in out
    assert "没有印象" not in out


def test_pick_recall_food_prefers_food_row():
    retrieved = [
        {"text": "player: 请记住我叫小明", "score": 0.95},
        {"text": "player: 告诉你一个秘密，我喜欢吃芒果～", "score": 0.7},
    ]
    picked = pick_recall_memory("你还记得我喜欢吃什么吗？", retrieved)
    assert picked is not None
    assert "芒果" in str(picked.get("text"))


def test_merge_recall_non_recall_question_unchanged():
    retrieved = [{"text": "player: 请记住我叫小明", "score": 0.9}]
    original = "好的，我这就移动到你的下方。"
    out = merge_recall_into_reply(
        "移动到我的下方",
        original,
        retrieved,
    )
    assert out == original


def test_merge_recall_password_prefers_password_row_over_higher_nickname():
    """Embed may rank nickname above password; merge must still pick password memory."""
    retrieved = [
        {"text": "player: 请记住我叫墨韵", "score": 0.95},
        {"text": "player: 请记住 sunset42 门禁密码是 7", "score": 0.82},
    ]
    wrong = "你之前告诉我的是 sunset42。"
    out = merge_recall_into_reply("我的门锁密码是多少来着？", wrong, retrieved)
    assert out == "门禁密码是 7。"


def test_merge_recall_men_suo_password_question():
    retrieved = [{"text": "player: 请记住 sunset42 门禁密码是 7", "score": 0.88}]
    out = merge_recall_into_reply(
        "我的门锁密码是多少来着？",
        "你之前告诉我的是 sunset42。",
        retrieved,
    )
    assert out == "门禁密码是 7。"


def test_pick_recall_password_no_unrelated_fallback():
    """Password recall must not fall back to nickname / unrelated rows."""
    retrieved = [{"text": "player: 请记住我叫墨韵", "score": 0.95}]
    assert pick_recall_memory("还记得我家电脑密码吗？", retrieved) is None


def test_pick_recall_computer_password_rejects_door_lock_only():
    """Computer password question must not pick door-lock memory."""
    retrieved = [{"text": "player: 请记住 sunset42 门禁密码是 7", "score": 0.95}]
    assert pick_recall_memory("还记得我家电脑密码吗？", retrieved) is None


def test_merge_recall_no_memory_blocks_hallucinated_password():
    out = merge_recall_into_reply(
        "还记得我家电脑密码吗？",
        "电脑密码是123456",
        [],
    )
    assert "123456" not in out
    assert "电脑密码" in out
    assert "没" in out


def test_merge_recall_computer_password_from_memory():
    retrieved = [{"text": "player: 请记住我家电脑密码是 111", "score": 0.9}]
    out = merge_recall_into_reply(
        "还记得我家电脑密码吗？",
        "电脑密码是123456",
        retrieved,
    )
    assert out == "电脑密码是 111。"


def test_pick_recall_prefers_newest_password_over_higher_embed():
    retrieved = [
        {"text": "player: 请记住我家电脑密码是 111", "score": 0.98, "recencyRank": 3},
        {"text": "player: 请记住我家电脑密码是 0101", "score": 0.72, "recencyRank": 0},
    ]
    picked = pick_recall_memory("还记得我家电脑密码是多少吗？", retrieved)
    assert picked is not None
    assert "0101" in str(picked.get("text"))


def test_merge_recall_replaces_ambiguous_multi_password_llm():
    retrieved = [
        {"text": "player: 请记住我家电脑密码是 0101", "score": 0.7, "recencyRank": 0},
        {"text": "player: 请记住我家电脑密码是 111", "score": 0.99, "recencyRank": 2},
        {"text": "player: 我家电脑密码是555", "score": 0.85, "recencyRank": 1},
    ]
    ambiguous = "你之前提到过密码是 111 和 555，这两个都说过，不确定哪个是正确的。"
    out = merge_recall_into_reply(
        "还记得我家电脑密码是多少吗？",
        ambiguous,
        retrieved,
    )
    assert out == "电脑密码是 0101。"


def test_merge_recall_replaces_ambiguous_llm_even_when_canonical_in_reply():
    """Screenshot bug: LLM lists 111、555、0101 then appends fact — must be fact only."""
    retrieved = [
        {"text": "player: 请记住我家电脑密码是 0101", "score": 0.7, "recencyRank": 1},
    ]
    ambiguous = "你之前提到过密码是 111、555 和 0101，不确定哪个是正确的。 电脑密码是 0101。"
    out = merge_recall_into_reply(
        "还记得我家电脑密码是多少吗？",
        ambiguous,
        retrieved,
    )
    assert out == "电脑密码是 0101。"
    assert "111" not in out
    assert "555" not in out
    assert "不确定" not in out


def test_pick_recall_prefers_player_seed_over_npc_paraphrase():
    retrieved = [
        {
            "text": "npc: 你刚刚说你的电脑密码是0101。",
            "score": 0.99,
            "recencyRank": 0,
        },
        {
            "text": "player: 请记住我家电脑密码是999",
            "score": 0.6,
            "recencyRank": 2,
        },
    ]
    picked = pick_recall_memory("还记得我家电脑密码是多少吗？", retrieved)
    assert picked is not None
    assert "999" in str(picked.get("text"))


def test_merge_recall_uses_latest_player_seed_999():
    retrieved = [
        {"text": "npc: 知道了，我去看看。", "score": 0.9, "recencyRank": 0},
        {"text": "player: 还记得我家电脑密码是多少吗？", "score": 0.85, "recencyRank": 1},
        {"text": "player: 请记住我家电脑密码是999", "score": 0.7, "recencyRank": 2},
        {"text": "npc: 你刚刚说你的电脑密码是0101。", "score": 0.95, "recencyRank": 3},
        {"text": "player: 请记住我家电脑密码是 0101", "score": 0.6, "recencyRank": 4},
    ]
    out = merge_recall_into_reply(
        "还记得我家电脑密码是多少吗？",
        "你之前提到过密码是 111、555 和 0101，不确定哪个是正确的。",
        retrieved,
    )
    assert out == "电脑密码是 999。"


def test_seed_disclosure_not_replaced_by_no_memory_guard():
    original = "知道了，我去看看。"
    assert (
        merge_recall_into_reply("请记住我家电脑密码是 111", original, None)
        == original
    )
