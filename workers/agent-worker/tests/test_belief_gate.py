"""Wave 0 stub — Phase 28 belief gate for player provoke (D-PLAYER-01…06, D-VERIFY-02).

GREEN fill: plan 08. Uses player↔NPC trust (npc_attitudes / collective), not npc_relationships (EA-5).
"""

from __future__ import annotations

import pytest


@pytest.mark.skip(reason="Wave 0 stub — implement in plan 08 (D-PLAYER-05)")
def test_belief_gate_hard_reject_below_minus_30() -> None:
    """D-PLAYER-05: effectiveScore < -30 → hard reject, no LLM, no A↔B delta."""


@pytest.mark.skip(reason="Wave 0 stub — implement in plan 08 (D-PLAYER-05)")
def test_belief_gate_skeptical_bias_below_zero() -> None:
    """D-PLAYER-05: effectiveScore < 0 → LLM with skeptical bias."""


@pytest.mark.skip(reason="Wave 0 stub — implement in plan 08 (D-PLAYER-05/06)")
def test_belief_reject_blocks_ab_delta_and_speaks_refusal() -> None:
    """D-PLAYER-05/06: reject → no A↔B apply; in-character refusal; optional trust micro-penalty."""


@pytest.mark.skip(reason="Wave 0 stub — implement in plan 08 (D-PLAYER-04)")
def test_provoke_dual_caps_pair_and_player_day() -> None:
    """D-PLAYER-04 / D-VERIFY-02: per-(A,B) 1/day + per-player 3 manipulations/day."""
