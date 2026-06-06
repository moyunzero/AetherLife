from src.config import Settings
from src.llm.openrouter_keys import openrouter_keys


def test_openrouter_keys_dedupes_primary_and_secondary(monkeypatch):
    monkeypatch.delenv("OPENROUTER_API_KEYS", raising=False)
    settings = Settings(
        openrouter_api_key="key-a",
        openrouter_api_key_2="key-b",
    )
    assert openrouter_keys(settings) == ["key-a", "key-b"]


def test_openrouter_keys_csv_overrides_order(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEYS", "key-c, key-a")
    settings = Settings(
        openrouter_api_key="key-a",
        openrouter_api_key_2="key-b",
    )
    assert openrouter_keys(settings) == ["key-c", "key-a", "key-b"]
