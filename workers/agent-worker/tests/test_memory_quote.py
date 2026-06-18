from src.graph.memory_quote import pick_memory_quote


def test_returns_none_when_memory_count_zero():
    assert pick_memory_quote([{"text": "player: hi", "score": 0.9}], 0) is None


def test_returns_none_when_retrieved_empty():
    assert pick_memory_quote([], 3) is None


def test_returns_none_when_best_score_below_min():
    assert pick_memory_quote([{"text": "player: weak", "score": 0.1}], 3) is None


def test_picks_highest_score_and_strips_player_prefix():
    quote = pick_memory_quote(
        [
            {"text": "player: older fact", "score": 0.5},
            {"text": "npc: ignored", "score": 0.2},
            {"text": "player: FACT-XYZ-42", "score": 0.91},
        ],
        5,
    )
    assert quote == "FACT-XYZ-42"


def test_strips_npc_prefix():
    quote = pick_memory_quote([{"text": "npc: 记得你提过", "score": 0.8}], 2)
    assert quote == "记得你提过"


def test_truncates_wire_length():
    long_text = "x" * 600
    quote = pick_memory_quote([{"text": f"player: {long_text}", "score": 1.0}], 1)
    assert quote is not None
    assert len(quote) == 500


def test_recall_picks_password_memory_for_quote():
    quote = pick_memory_quote(
        [
            {"text": "player: 请记住我叫墨韵", "score": 0.95},
            {"text": "player: 请记住 sunset42 门禁密码是 7", "score": 0.82},
        ],
        3,
        player_message="我的门锁密码是多少来着？",
    )
    assert quote == "请记住 sunset42 门禁密码是 7"
