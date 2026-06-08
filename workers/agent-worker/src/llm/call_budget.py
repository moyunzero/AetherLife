"""Per-speak LLM call budget recorder (Phase 12.2 STAB-03)."""

from __future__ import annotations

import json
from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Any

_recorder_var: ContextVar[LlmCallRecorder | None] = ContextVar(
    "llm_call_recorder",
    default=None,
)


@dataclass
class LlmCallRecorder:
    """Accumulates LLM invocations for one speak job."""

    calls: list[dict[str, str]] = field(default_factory=list)

    def record(self, role: str, provider: str, model: str) -> None:
        self.calls.append(
            {
                "role": role,
                "provider": provider.lower(),
                "model": model,
            },
        )

    def summarize(self) -> list[dict[str, str]]:
        return list(self.calls)

    @property
    def total(self) -> int:
        return len(self.calls)


def start_recorder() -> LlmCallRecorder:
    recorder = LlmCallRecorder()
    _recorder_var.set(recorder)
    return recorder


def get_recorder() -> LlmCallRecorder | None:
    return _recorder_var.get()


def record_llm_call(role: str, provider: str, model: str) -> None:
    recorder = get_recorder()
    if recorder is not None:
        recorder.record(role, provider, model)


def summarize_for_log(recorder: LlmCallRecorder) -> str:
    return json.dumps(recorder.summarize(), ensure_ascii=False)


def llm_call_summary_payload(recorder: LlmCallRecorder | None) -> dict[str, Any] | None:
    if recorder is None or recorder.total == 0:
        return None
    return {"calls": recorder.summarize(), "total": recorder.total}
