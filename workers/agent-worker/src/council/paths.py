"""Monorepo root resolution for council JSON mirrors."""

from __future__ import annotations

from pathlib import Path

_COUNCIL_DIR = Path(__file__).resolve().parent


def monorepo_root() -> Path:
    for parent in _COUNCIL_DIR.parents:
        if (parent / "pnpm-workspace.yaml").is_file():
            return parent
    return _COUNCIL_DIR.parents[3]
