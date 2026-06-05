import re

try:
    from openai import RateLimitError
except ImportError:  # pragma: no cover
    RateLimitError = ()  # type: ignore[misc, assignment]

_PROVIDER_RE = re.compile(r"['\"]provider_name['\"]\s*:\s*['\"]([^'\"]+)['\"]")


def is_rate_limit_error(exc: BaseException) -> bool:
    if RateLimitError and isinstance(exc, RateLimitError):
        return True
    text = str(exc).lower()
    return "429" in str(exc) or "rate limit" in text or "rate-limited" in text


def is_provider_error(exc: BaseException) -> bool:
    text = str(exc).lower()
    if any(code in str(exc) for code in ("503", "502", "504")):
        return True
    return "provider returned error" in text or "no healthy upstream" in text


def is_model_not_found_error(exc: BaseException) -> bool:
    text = str(exc).lower()
    return "404" in str(exc) or "no endpoints found" in text


def is_auth_error(exc: BaseException) -> bool:
    text = str(exc).lower()
    return "401" in str(exc) or "403" in str(exc) or "invalid api key" in text


def is_quota_error(exc: BaseException) -> bool:
    text = str(exc).lower()
    return "402" in str(exc) or "spend limit exceeded" in text


def is_retryable_llm_error(exc: BaseException) -> bool:
    return is_rate_limit_error(exc) or is_provider_error(exc) or is_model_not_found_error(exc)


def provider_name(exc: BaseException) -> str | None:
    match = _PROVIDER_RE.search(str(exc))
    return match.group(1) if match else None


def retry_after_seconds(exc: BaseException, *, default: int = 30) -> int:
    match = re.search(r"retry_after_seconds['\"]?\s*[:=]\s*(\d+)", str(exc))
    if match:
        return min(int(match.group(1)) + 1, 60)
    return default


def _http_status_hint(exc: BaseException) -> str:
    for code in ("502", "503", "504"):
        if code in str(exc):
            return code
    return "503"


def format_llm_error(exc: BaseException) -> str:
    if is_quota_error(exc):
        return (
            "OpenRouter API Key 已达 USD 消费上限（402）。"
            "请在 openrouter.ai/settings/keys 提高限额、充值，或换用有余量的 Key / 非 :free 模型。"
        )
    if is_rate_limit_error(exc):
        wait = retry_after_seconds(exc)
        return (
            f"OpenRouter 免费模型当前被限流（429），请约 {wait} 秒后重试，"
            "或在 .env 更换 LLM_MODEL / LLM_MODEL_FALLBACKS；"
            "也可充值 10 credits 解锁更高 free 配额。"
        )
    if is_provider_error(exc):
        name = provider_name(exc) or "上游"
        code = _http_status_hint(exc)
        return (
            f"OpenRouter 上游服务不可用（{code}，{name}），这是模型提供商故障，不是本地代码问题。"
            "请稍后重试，或改用 LLM_MODEL=openrouter/free。"
        )
    if is_model_not_found_error(exc):
        return (
            "OpenRouter 找不到该模型（404），模型 ID 可能已下线。"
            "请在 .env 设置 LLM_MODEL=openrouter/free，或到 openrouter.ai/models 筛选 :free 模型。"
        )
    text = str(exc)
    if "missing API key" in text.lower():
        return "未配置 LLM API Key，请在 .env 设置 OPENROUTER_API_KEY。"
    if len(text) > 200:
        return text[:200] + "…"
    return text
