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


@pytest.mark.asyncio
async def test_parse_intent_json_heuristic_on_malformed_openrouter(monkeypatch):
    monkeypatch.delenv("LLM_MOCK", raising=False)
    monkeypatch.setenv("OPENROUTER_API_KEYS", "test-key")
    monkeypatch.setenv("LLM_MODEL", "openai/gpt-oss-120b:free")

    class FakeResponse:
        status_code = 200

        def raise_for_status(self):
            return None

        def json(self):
            return {"choices": [{"message": {"content": "not-json"}}]}

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def post(self, *args, **kwargs):
            return FakeResponse()

    monkeypatch.setattr("app.services.llm.httpx.AsyncClient", lambda **kwargs: FakeClient())

    from app.services.llm import parse_intent_json

    result = await parse_intent_json("等一下")
    assert result == {"type": "wait", "durationMs": 1000}
