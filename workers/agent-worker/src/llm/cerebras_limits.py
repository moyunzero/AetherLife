"""Client-side quota guard for Cerebras Cloud (gpt-oss-120b).

Defaults match org Production tier shown on cloud.cerebras.ai:
  requests: 5/min, 150/hour, 2400/day
  tokens:   30k/min, 1M/hour, 1M/day
  context:  65,536 tokens (enforced via max_completion_tokens hint in factory)
"""

from __future__ import annotations

import os
import threading
import time
from collections import deque
from typing import Any

from src.config import Settings

_DEFAULT_REQUESTS_PER_MINUTE = 5
_DEFAULT_REQUESTS_PER_HOUR = 150
_DEFAULT_REQUESTS_PER_DAY = 2400
_DEFAULT_TOKENS_PER_MINUTE = 30_000
_DEFAULT_TOKENS_PER_HOUR = 1_000_000
_DEFAULT_TOKENS_PER_DAY = 1_000_000

_limiter: "CerebrasRateLimiter | None" = None
_limiter_lock = threading.Lock()


def _int_env(name: str, default: int) -> int:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        return max(1, int(raw))
    except ValueError:
        return default


class CerebrasRateLimiter:
    """Sliding-window limiter for a single worker process."""

    def __init__(
        self,
        *,
        requests_per_minute: int,
        requests_per_hour: int,
        requests_per_day: int,
        tokens_per_minute: int,
        tokens_per_hour: int,
        tokens_per_day: int,
    ) -> None:
        self.requests_per_minute = requests_per_minute
        self.requests_per_hour = requests_per_hour
        self.requests_per_day = requests_per_day
        self.tokens_per_minute = tokens_per_minute
        self.tokens_per_hour = tokens_per_hour
        self.tokens_per_day = tokens_per_day
        self._lock = threading.Lock()
        self._request_times: deque[float] = deque()
        self._token_events: deque[tuple[float, int]] = deque()

    @classmethod
    def from_settings(cls, settings: Settings | None = None) -> "CerebrasRateLimiter":
        _ = settings
        return cls(
            requests_per_minute=_int_env(
                "CEREBRAS_REQUESTS_PER_MINUTE", _DEFAULT_REQUESTS_PER_MINUTE
            ),
            requests_per_hour=_int_env(
                "CEREBRAS_REQUESTS_PER_HOUR", _DEFAULT_REQUESTS_PER_HOUR
            ),
            requests_per_day=_int_env(
                "CEREBRAS_REQUESTS_PER_DAY", _DEFAULT_REQUESTS_PER_DAY
            ),
            tokens_per_minute=_int_env(
                "CEREBRAS_TOKENS_PER_MINUTE", _DEFAULT_TOKENS_PER_MINUTE
            ),
            tokens_per_hour=_int_env(
                "CEREBRAS_TOKENS_PER_HOUR", _DEFAULT_TOKENS_PER_HOUR
            ),
            tokens_per_day=_int_env(
                "CEREBRAS_TOKENS_PER_DAY", _DEFAULT_TOKENS_PER_DAY
            ),
        )

    def _prune(self, now: float) -> None:
        day_ago = now - 86_400
        hour_ago = now - 3_600
        minute_ago = now - 60
        while self._request_times and self._request_times[0] < day_ago:
            self._request_times.popleft()
        while self._token_events and self._token_events[0][0] < day_ago:
            self._token_events.popleft()
        self._minute_requests = sum(1 for t in self._request_times if t >= minute_ago)
        self._hour_requests = sum(1 for t in self._request_times if t >= hour_ago)
        self._day_requests = len(self._request_times)
        self._minute_tokens = sum(
            n for t, n in self._token_events if t >= minute_ago
        )
        self._hour_tokens = sum(n for t, n in self._token_events if t >= hour_ago)
        self._day_tokens = sum(n for _, n in self._token_events)

    def _sleep_until(self, wait_s: float) -> None:
        if wait_s > 0:
            time.sleep(min(wait_s, 60.0))

    def acquire(self, *, estimated_tokens: int = 4_000) -> None:
        """Block until a request fits all request + token windows."""
        est = max(1, estimated_tokens)
        while True:
            with self._lock:
                now = time.time()
                self._prune(now)
                waits: list[float] = []

                if self._minute_requests >= self.requests_per_minute:
                    oldest = next(
                        t for t in self._request_times if t >= now - 60
                    )
                    waits.append(60 - (now - oldest) + 0.05)
                if self._hour_requests >= self.requests_per_hour:
                    oldest = next(
                        t for t in self._request_times if t >= now - 3_600
                    )
                    waits.append(3_600 - (now - oldest) + 0.05)
                if self._day_requests >= self.requests_per_day:
                    waits.append(60.0)
                if self._minute_tokens + est > self.tokens_per_minute:
                    waits.append(1.0)
                if self._hour_tokens + est > self.tokens_per_hour:
                    waits.append(5.0)
                if self._day_tokens + est > self.tokens_per_day:
                    waits.append(60.0)

                if not waits:
                    self._request_times.append(now)
                    self._token_events.append((now, est))
                    return

            self._sleep_until(min(waits))

    def adjust_actual_tokens(self, estimated: int, actual: int) -> None:
        """Replace last estimate with provider-reported usage when available."""
        delta = actual - estimated
        if delta == 0:
            return
        with self._lock:
            if not self._token_events:
                return
            t, n = self._token_events.pop()
            self._token_events.append((t, max(0, n + delta)))


def get_cerebras_limiter(settings: Settings | None = None) -> CerebrasRateLimiter:
    global _limiter
    with _limiter_lock:
        if _limiter is None:
            _limiter = CerebrasRateLimiter.from_settings(settings)
        return _limiter


def estimate_prompt_tokens(messages: Any) -> int:
    """Rough token budget before the HTTP call (chars/4)."""
    if not messages:
        return 4_000
    parts: list[str] = []
    if isinstance(messages, str):
        parts.append(messages)
    elif isinstance(messages, list):
        for item in messages:
            if isinstance(item, dict):
                parts.append(str(item.get("content", "")))
            else:
                content = getattr(item, "content", None)
                if content is not None:
                    parts.append(str(content))
                else:
                    parts.append(str(item))
    else:
        parts.append(str(messages))
    chars = sum(len(p) for p in parts)
    return max(256, min(chars // 4 + 256, 8_000))


def usage_total_tokens(response: Any) -> int | None:
    meta = getattr(response, "response_metadata", None) or {}
    usage = meta.get("token_usage") or meta.get("usage") or {}
    if isinstance(usage, dict):
        total = usage.get("total_tokens")
        if total is not None:
            return int(total)
        prompt = int(usage.get("prompt_tokens") or 0)
        completion = int(usage.get("completion_tokens") or 0)
        if prompt or completion:
            return prompt + completion
    return None
