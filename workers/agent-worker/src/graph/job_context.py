"""Per-job callbacks and phase timing for interactive speak turns."""

from __future__ import annotations

from contextvars import ContextVar
from typing import Callable

PartialEmitFn = Callable[[str], None]

_partial_emit: ContextVar[PartialEmitFn | None] = ContextVar("partial_emit", default=None)
_phase_timing: ContextVar[dict[str, int] | None] = ContextVar("phase_timing", default=None)


def set_job_context(
    *,
    partial_emit: PartialEmitFn | None = None,
    phase_timing: dict[str, int] | None = None,
) -> tuple[object, object]:
    """Install context; returns tokens for reset."""
    t1 = _partial_emit.set(partial_emit)
    t2 = _phase_timing.set(phase_timing)
    return t1, t2


def reset_job_context(tokens: tuple[object, object]) -> None:
    t1, t2 = tokens
    _partial_emit.reset(t1)
    _phase_timing.reset(t2)


def get_partial_emit() -> PartialEmitFn | None:
    return _partial_emit.get()


def get_phase_timing() -> dict[str, int] | None:
    return _phase_timing.get()


def record_phase_ms(name: str, ms: int) -> None:
    timing = _phase_timing.get()
    if timing is not None:
        timing[name] = ms
