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
    """
    Set per-job context values for a job's partial-emission callback and phase-timing map.
    
    Stores the provided `partial_emit` and `phase_timing` in the module's context variables and returns the two context tokens required to restore the previous values.
    
    Parameters:
    	partial_emit (PartialEmitFn | None): Optional callback that receives partial emitted text.
    	phase_timing (dict[str, int] | None): Optional mapping to record phase durations in milliseconds.
    
    Returns:
    	tuple[object, object]: Tokens that must be passed to `reset_job_context` to reset the context to its prior state.
    """
    t1 = _partial_emit.set(partial_emit)
    t2 = _phase_timing.set(phase_timing)
    return t1, t2


def reset_job_context(tokens: tuple[object, object]) -> None:
    """
    Reset the per-job context variables to the states represented by the given tokens.
    
    Parameters:
        tokens (tuple[object, object]): The pair of context token objects returned by `set_job_context`, in the same order; the first token resets the partial-emission callback context and the second resets the phase-timing context.
    """
    t1, t2 = tokens
    _partial_emit.reset(t1)
    _phase_timing.reset(t2)


def get_partial_emit() -> PartialEmitFn | None:
    """
    Return the per-job partial emission callback for the current context.
    
    Returns:
        PartialEmitFn | None: The callback that accepts a single string and emits partial text, or `None` if no callback is set.
    """
    return _partial_emit.get()


def get_phase_timing() -> dict[str, int] | None:
    """
    Retrieve the per-job phase timing mapping for the current context.
    
    Returns:
        dict[str, int] mapping phase names to durations in milliseconds, or `None` if no timing map is set.
    """
    return _phase_timing.get()


def record_phase_ms(name: str, ms: int) -> None:
    """
    Record a phase's duration (milliseconds) in the active phase-timing mapping, if present.
    
    Parameters:
        name (str): The phase name to record.
        ms (int): Duration of the phase in milliseconds; overwrites any existing value for `name`.
    """
    timing = _phase_timing.get()
    if timing is not None:
        timing[name] = ms
