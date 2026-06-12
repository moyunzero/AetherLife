import pytest

from app.services.llm import _parse_openrouter_content


def test_parse_openrouter_content_valid_move():
    body = {
        "choices": [
            {"message": {"content": '{"type":"move","x":3,"y":4}'}}
        ]
    }
    assert _parse_openrouter_content(body) == {"type": "move", "x": 3.0, "y": 4.0}


def test_parse_openrouter_content_rejects_invalid_action():
    body = {
        "choices": [
            {"message": {"content": '{"type":"speak","targetId":"","content":"hi"}'}}
        ]
    }
    with pytest.raises(ValueError, match="String should have at least 1 character"):
        _parse_openrouter_content(body)


def test_parse_openrouter_content_rejects_malformed_envelope():
    with pytest.raises(ValueError, match="missing choices"):
        _parse_openrouter_content({"choices": []})
