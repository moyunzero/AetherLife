from app.models.actions import validate_nl_action


def test_move_valid():
    parsed, err = validate_nl_action({"type": "move", "x": 3, "y": 4})
    assert err is None
    assert parsed == {"type": "move", "x": 3.0, "y": 4.0}


def test_transfer_valid():
    parsed, err = validate_nl_action(
        {"type": "transfer", "itemId": "key-1", "toNpcId": "npc-2"},
    )
    assert err is None
    assert parsed["toNpcId"] == "npc-2"


def test_invalid_type():
    parsed, err = validate_nl_action({"type": "fly", "x": 1})
    assert parsed is None
    assert err is not None
