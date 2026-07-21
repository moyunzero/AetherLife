"""Wave 0 stub — Phase 28 relationship embedding RAG for speak (D-EMBED-01…04, D-VERIFY-01).

GREEN fill: plan 09 (async embed + relationship_rag paraphrase).
"""

from __future__ import annotations

import pytest


@pytest.mark.skip(reason="Wave 0 stub — implement in plan 09 (D-EMBED-01)")
def test_relationship_rag_prefers_active_npc_edges() -> None:
    """D-EMBED-04: retrieve active NPC edges first for speak context."""


@pytest.mark.skip(reason="Wave 0 stub — implement in plan 09 (D-EMBED-02/04)")
def test_relationship_rag_third_party_analogy_paraphrase() -> None:
    """D-EMBED-04 / D-VERIFY-01: cross-NPC analogy when topic references third party (≤2 bullets)."""


@pytest.mark.skip(reason="Wave 0 stub — implement in plan 09 (D-EMBED-03)")
def test_relationship_rag_lazy_embed_when_missing() -> None:
    """D-EMBED-03: lazy embed on speak if edge embedding is null."""
