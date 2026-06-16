"""Benchmark social JSON LLM candidates (real API, reads root .env).

Usage (from repo root):
  cd workers/agent-worker && uv run python ../../scripts/benchmark-social-providers.py
"""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

_REPO = Path(__file__).resolve().parents[1]
_WORKER = _REPO / "workers" / "agent-worker"
sys.path.insert(0, str(_WORKER))

from langchain_core.messages import HumanMessage, SystemMessage

from src.config import get_settings
from src.graph.nodes.llm_social_turn import SOCIAL_SYSTEM_PROMPT, _parse_social_turn_json
from src.llm.factory import create_chat_model

PLAYER_MSG = "你在看什么书呢？"
TIMEOUT_S = 25.0

# Candidates: (label, provider, model)
CANDIDATES = [
    ("deprecated-397b", "nvidia", "qwen/qwen3.5-397b-a17b"),
    ("nvidia-fast-80b", "nvidia", "qwen/qwen3-next-80b-a3b-instruct"),
    ("nvidia-mistral-nemotron", "nvidia", "mistralai/mistral-nemotron"),
    ("nvidia-llama-70b", "nvidia", "meta/llama-3.3-70b-instruct"),
    ("nvidia-gpt-oss-20b", "nvidia", "openai/gpt-oss-20b"),
    ("nvidia-qwen-122b", "nvidia", "qwen/qwen3.5-122b-a10b"),
    ("agnes-flash", "agnes", "agnes-2.0-flash"),
    ("openrouter-free", "openrouter", "openai/gpt-oss-120b:free"),
]

MESSAGES = [
    SystemMessage(content=SOCIAL_SYSTEM_PROMPT),
    HumanMessage(content=f"Player message: {PLAYER_MSG}"),
]


def probe(label: str, provider: str, model: str) -> dict:
    settings = get_settings()
    out: dict = {"label": label, "provider": provider, "model": model}
    try:
        llm = create_chat_model(
            settings=settings,
            provider=provider,
            model=model,
            request_timeout=TIMEOUT_S,
        )
        t0 = time.perf_counter()
        response = llm.invoke(MESSAGES)
        ms = int((time.perf_counter() - t0) * 1000)
        content = str(getattr(response, "content", "") or "")
        parsed = _parse_social_turn_json(content)
        out.update(
            {
                "ok": parsed is not None,
                "latency_ms": ms,
                "reply_len": len(parsed.reply) if parsed else len(content),
                "reply_preview": (parsed.reply[:80] if parsed else content[:80]),
                "social_kind": parsed.social.kind if parsed else None,
            }
        )
        if parsed is None:
            out["error"] = "JSON parse failed"
    except Exception as exc:
        out.update({"ok": False, "latency_ms": None, "error": f"{type(exc).__name__}: {exc}"})
    return out


def main() -> None:
    settings = get_settings()
    if settings.llm_mock or os.getenv("LLM_MOCK") == "1":
        print("Unset LLM_MOCK before benchmarking.")
        sys.exit(1)
    results = [probe(*c) for c in CANDIDATES]
    print(json.dumps(results, ensure_ascii=False, indent=2))
    ok = [r for r in results if r.get("ok")]
    if ok:
        best = min(ok, key=lambda r: r["latency_ms"])
        print(
            f"\nBest parse OK: {best['label']} {best['provider']}/{best['model']} "
            f"in {best['latency_ms']}ms",
            file=sys.stderr,
        )


if __name__ == "__main__":
    main()
