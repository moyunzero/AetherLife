"""Monorepo root resolution for council JSON mirrors."""

from __future__ import annotations

from pathlib import Path

from src.council.paths import monorepo_root


def test_monorepo_root_finds_pnpm_workspace():
    root = monorepo_root()
    assert (root / "pnpm-workspace.yaml").is_file()
    assert (root / "packages" / "shared").is_dir()


def test_monorepo_root_fallback_parents_depth():
    from src.council import paths as paths_mod

    council_dir = Path(paths_mod.__file__).resolve().parent

    def fake_parents():
        # parents[0]=council, [1]=src, [2]=agent-worker, [3]=workers, [4]=repo root
        return (
            council_dir,
            council_dir.parent,
            council_dir.parents[1],
            council_dir.parents[2],
            council_dir.parents[3],
        )

    class FakePath:
        parents = fake_parents()

    original = paths_mod._COUNCIL_DIR
    paths_mod._COUNCIL_DIR = FakePath()  # type: ignore[assignment]
    try:
        assert monorepo_root() == council_dir.parents[3]
    finally:
        paths_mod._COUNCIL_DIR = original
