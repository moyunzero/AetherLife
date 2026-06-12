import pytest
from unittest.mock import AsyncMock, patch

from app.guards.content import ModerationApiGuard
from app.guards.responses import guard_denied_response


@pytest.mark.asyncio
async def test_moderation_outage_production_returns_unavailable_code(monkeypatch):
    monkeypatch.setenv("NODE_ENV", "production")
    guard = ModerationApiGuard()

    mock_response = AsyncMock()
    mock_response.status_code = 503
    mock_response.json = lambda: {}

    with patch("app.guards.content.get_settings") as settings_mock:
        settings_mock.return_value.openai_api_key = "sk-test"
        with patch("httpx.AsyncClient") as client_cls:
            client = AsyncMock()
            client.__aenter__.return_value = client
            client.__aexit__.return_value = None
            client.post.return_value = mock_response
            client_cls.return_value = client

            result = await guard.check("hello")

    assert not result.allowed
    assert result.code == "moderation_unavailable"
    response = guard_denied_response(result)
    assert response.status_code == 503
    body = response.body.decode()
    assert "moderation_unavailable" in body


@pytest.mark.asyncio
async def test_moderation_outage_dev_allows(monkeypatch):
    monkeypatch.delenv("NODE_ENV", raising=False)
    guard = ModerationApiGuard()

    mock_response = AsyncMock()
    mock_response.status_code = 503

    with patch("app.guards.content.get_settings") as settings_mock:
        settings_mock.return_value.openai_api_key = "sk-test"
        with patch("httpx.AsyncClient") as client_cls:
            client = AsyncMock()
            client.__aenter__.return_value = client
            client.__aexit__.return_value = None
            client.post.return_value = mock_response
            client_cls.return_value = client

            result = await guard.check("hello")

    assert result.allowed
