from src.llm.errors import (
    format_llm_error,
    is_model_not_found_error,
    is_provider_error,
    is_rate_limit_error,
    provider_name,
    retry_after_seconds,
)
from src.llm.factory import models_to_try
from src.config import Settings


def test_is_rate_limit_error_from_status():
    exc = Exception("Error code: 429 - rate-limited upstream")
    assert is_rate_limit_error(exc)


def test_is_provider_error_503():
    exc = Exception(
        "Error code: 503 - {'metadata': {'raw': 'no healthy upstream', 'provider_name': 'OpenInference'}}"
    )
    assert is_provider_error(exc)
    assert provider_name(exc) == "OpenInference"


def test_retry_after_seconds_parsed():
    exc = Exception("metadata: {'retry_after_seconds': 29}")
    assert retry_after_seconds(exc) == 30


def test_format_llm_error_rate_limit_is_user_friendly():
    exc = Exception("Error code: 429 - meta-llama/llama-3.3-70b-instruct:free is rate-limited")
    msg = format_llm_error(exc)
    assert "限流" in msg
    assert "Error code" not in msg


def test_format_llm_error_provider_is_user_friendly():
    exc = Exception(
        "Error code: 503 - {'metadata': {'provider_name': 'OpenInference', 'raw': 'no healthy upstream'}}"
    )
    msg = format_llm_error(exc)
    assert "503" in msg
    assert "OpenInference" in msg
    assert "Error code" not in msg


def test_is_model_not_found_error():
    exc = Exception("Error code: 404 - No endpoints found for google/gemma-2-9b-it:free.")
    assert is_model_not_found_error(exc)


def test_format_llm_error_model_not_found():
    exc = Exception("Error code: 404 - No endpoints found for google/gemma-2-9b-it:free.")
    msg = format_llm_error(exc)
    assert "404" in msg
    assert "openrouter/free" in msg


def test_models_to_try_deduplicates():
    settings = Settings(
        llm_model="openrouter/free",
        llm_model_fallbacks="openrouter/free,meta-llama/llama-3.2-3b-instruct:free",
    )
    assert models_to_try(settings) == [
        "openrouter/free",
        "meta-llama/llama-3.2-3b-instruct:free",
    ]
