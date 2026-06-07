import os

import pytest

from src.collective.repository import _database_url, _use_in_memory


def test_use_in_memory_false_when_settings_has_database_url(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("LLM_MOCK", raising=False)
    assert _database_url() is not None
    assert _use_in_memory() is False


def test_use_in_memory_true_when_no_database_url(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("LLM_MOCK", raising=False)
    monkeypatch.setattr(
        "src.collective.repository._database_url",
        lambda: None,
    )
    assert _use_in_memory() is True


def test_use_in_memory_true_when_llm_mock(monkeypatch):
    monkeypatch.setenv("LLM_MOCK", "1")
    assert _use_in_memory() is True
