"""Wave 0 stub — Phase 28 npc-mutual-chat worker (D-MUTUAL-01…07, D-VERIFY-01).

GREEN fill: plan 06 (handler, delta thresholds, REL-07, bubble broadcast).
"""

from __future__ import annotations

import pytest


@pytest.mark.skip(reason="Wave 0 stub — implement in plan 06 (D-MUTUAL)")
def test_mutual_chat_applies_deltas_and_thresholds() -> None:
    """D-MUTUAL-04: all deltas to DB; |Δ|≥4 → REL-07; |Δ|≥8 → linkedEdges hint."""


@pytest.mark.skip(reason="Wave 0 stub — implement in plan 06 (D-MUTUAL-06)")
def test_mutual_chat_memory_stays_on_council_scope() -> None:
    """D-MUTUAL-06: optional __council__ summary; never player speak cross-contamination."""


@pytest.mark.skip(reason="Wave 0 stub — implement in plan 06 (D-MUTUAL-02)")
def test_mutual_chat_emits_activity_and_bubble_payload() -> None:
    """D-MUTUAL-02: dual intentReasonZh + mutualChatBubble one-shot message."""
