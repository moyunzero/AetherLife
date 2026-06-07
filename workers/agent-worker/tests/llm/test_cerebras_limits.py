import time

from src.llm.cerebras_limits import CerebrasRateLimiter


def test_cerebras_rate_limiter_from_defaults():
    limiter = CerebrasRateLimiter.from_settings()
    assert limiter.requests_per_minute == 5
    assert limiter.tokens_per_minute == 30_000


def test_acquire_under_high_limits_does_not_block():
    limiter = CerebrasRateLimiter(
        requests_per_minute=100,
        requests_per_hour=100,
        requests_per_day=100,
        tokens_per_minute=100_000,
        tokens_per_hour=100_000,
        tokens_per_day=100_000,
    )
    started = time.time()
    limiter.acquire(estimated_tokens=100)
    limiter.acquire(estimated_tokens=100)
    assert time.time() - started < 0.5
