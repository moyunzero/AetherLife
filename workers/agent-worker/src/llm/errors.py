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


def is_connection_error(exc: BaseException) -> bool:
    text = str(exc).lower()
    needles = (
        "connection error",
        "connection refused",
        "connect timeout",
        "timed out",
        "timeout",
        "network is unreachable",
        "failed to establish",
    )
    return any(n in text for n in needles)


def should_try_lore_provider_fallback(exc: BaseException) -> bool:
    """Try LLM_PROVIDER_LORE_FALLBACK when the primary lore provider is unreachable."""
    if is_quota_error(exc):
        return True
    return (
        is_retryable_llm_error(exc)
        or is_auth_error(exc)
        or is_connection_error(exc)
    )


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


_PROVIDER_LABELS: dict[str, str] = {
    "openrouter": "OpenRouter",
    "zhipu": "智谱 AI",
    "groq": "Groq",
    "agnes": "Agnes",
}

_KEY_ENV: dict[str, str] = {
    "openrouter": "OPENROUTER_API_KEY",
    "zhipu": "ZHIPU_API_KEY",
    "groq": "GROQ_API_KEY",
    "agnes": "AGNES_API_KEY",
}

_FALLBACK_HINT = (
    "可在 .env 同时设置 LLM_PROVIDER_FALLBACK 与 LLM_MODEL_FALLBACKS 启用跨 provider 兜底。"
)


class LlmCallError(Exception):
    """LLM 调用失败，附带实际使用的 provider（便于用户可见错误文案）。"""

    def __init__(
        self,
        cause: BaseException,
        *,
        provider: str,
        model: str | None = None,
    ) -> None:
        self.cause = cause
        self.provider = provider.lower().strip()
        self.model = model
        super().__init__(str(cause))


def _resolve_provider(exc: BaseException, hint: str | None) -> str:
    text = str(exc).lower()
    if "openrouter" in text or "usd spend limit" in text:
        return "openrouter"
    if "no endpoints found" in text:
        return "openrouter"
    if ":free" in text and ("rate-limited" in text or "rate limit" in text):
        return "openrouter"
    if provider_name(exc) is not None and "metadata" in text:
        return "openrouter"
    if "bigmodel" in text or "zhipu" in text or "智谱" in text:
        return "zhipu"
    if "groq" in text:
        return "groq"
    if "agnes" in text:
        return "agnes"
    if hint:
        return hint.lower().strip()
    return "unknown"


def _provider_label(provider: str) -> str:
    return _PROVIDER_LABELS.get(provider, "LLM")


def format_llm_error(exc: BaseException, *, provider: str | None = None) -> str:
    cause = exc
    prov_hint = provider
    if isinstance(exc, LlmCallError):
        cause = exc.cause
        prov_hint = exc.provider
    resolved = _resolve_provider(cause, prov_hint)
    label = _provider_label(resolved)

    if is_quota_error(cause):
        if resolved == "openrouter":
            return (
                "OpenRouter API Key 已达 USD 消费上限（402）。"
                "请在 openrouter.ai/settings/keys 提高限额、充值，或换用有余量的 Key / 非 :free 模型。"
            )
        return (
            f"{label} API 配额或余额不足（402），请检查账户限额或更换 API Key。"
            f"{_FALLBACK_HINT}"
        )
    if is_rate_limit_error(cause):
        wait = retry_after_seconds(cause)
        if resolved == "openrouter":
            return (
                f"{label} 免费模型当前被限流（429），请约 {wait} 秒后重试，"
                "或在 .env 更换 LLM_MODEL / LLM_MODEL_FALLBACKS；"
                "也可充值 10 credits 解锁更高 free 配额。"
            )
        return (
            f"{label} API 当前被限流（429），请约 {wait} 秒后重试，"
            f"或检查对应 API Key 配额；{_FALLBACK_HINT}"
        )
    if is_provider_error(cause):
        name = provider_name(cause) or "上游"
        code = _http_status_hint(cause)
        if resolved == "openrouter":
            return (
                f"{label} 上游服务不可用（{code}，{name}），这是模型提供商故障，不是本地代码问题。"
                "请稍后重试，或改用 LLM_MODEL=openrouter/free。"
            )
        return (
            f"{label} 服务暂时不可用（{code}），请稍后重试。{_FALLBACK_HINT}"
        )
    if is_model_not_found_error(cause):
        if resolved == "openrouter":
            return (
                "OpenRouter 找不到该模型（404），模型 ID 可能已下线。"
                "请在 .env 设置 LLM_MODEL=openrouter/free，或到 openrouter.ai/models 筛选 :free 模型。"
            )
        return (
            f"{label} 找不到该模型（404），请检查 .env 中 LLM_MODEL 是否在 {label} 可用。"
        )
    text = str(cause)
    if "missing api key" in text.lower():
        env_key = _KEY_ENV.get(resolved, "OPENROUTER_API_KEY")
        return f"未配置 {label} API Key，请在 .env 设置 {env_key}。"
    if len(text) > 200:
        return text[:200] + "…"
    return text
