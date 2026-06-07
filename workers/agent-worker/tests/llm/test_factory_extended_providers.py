import pytest

from src.config import Settings
from src.llm.factory import PROVIDER_BASE_URLS, create_chat_model


def test_provider_base_urls_include_siliconflow_and_nvidia():
    assert "siliconflow" in PROVIDER_BASE_URLS
    assert "nvidia" in PROVIDER_BASE_URLS


def test_create_siliconflow_model_injects_enable_thinking_false(monkeypatch):
    captured: dict = {}

    class FakeChatOpenAI:
        def __init__(self, **kwargs):
            captured.update(kwargs)

    monkeypatch.setattr("src.llm.factory.ChatOpenAI", FakeChatOpenAI)
    create_chat_model(
        provider="siliconflow",
        model="Qwen/Qwen3.5-4B",
        settings=Settings(siliconflow_api_key="sf-test"),
    )
    assert captured["extra_body"] == {"enable_thinking": False}
    assert captured["base_url"] == "https://api.siliconflow.cn/v1"


def test_create_nvidia_model_uses_integrate_base(monkeypatch):
    captured: dict = {}

    class FakeChatOpenAI:
        def __init__(self, **kwargs):
            captured.update(kwargs)

    monkeypatch.setattr("src.llm.factory.ChatOpenAI", FakeChatOpenAI)
    create_chat_model(
        provider="nvidia",
        settings=Settings(nvidia_api_key="nv-test"),
    )
    assert captured["base_url"] == "https://integrate.api.nvidia.com/v1"
    assert captured["model"] == "qwen/qwen3-next-80b-a3b-instruct"


def test_missing_siliconflow_key_raises():
    with pytest.raises(ValueError, match="missing API key"):
        create_chat_model(provider="siliconflow", settings=Settings(siliconflow_api_key=None))
