"""Phase 28 belief gate for player provoke (D-PLAYER-01…06, D-VERIFY-02, EA-5/EA-6).

Uses player↔NPC trust (npc_attitudes / collective effectiveScore), not npc_relationships.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

import pytest

from src.council import belief_gate as bg


@pytest.fixture(autouse=True)
def _clear_caps() -> None:
    bg.clear_manipulation_caps_for_test()


def test_belief_gate_hard_reject_below_minus_30() -> None:
    """D-PLAYER-05: effectiveScore < -30 → hard reject, no LLM, no A↔B delta."""
    llm_calls: list[dict[str, Any]] = []
    apply_calls: list[dict[str, Any]] = []

    def fake_llm(**kwargs: Any) -> bg.BeliefJudgment:
        llm_calls.append(kwargs)
        return bg.BeliefJudgment(decision="accept", reason="should not run")

    def fake_apply(**kwargs: Any) -> None:
        apply_calls.append(kwargs)

    result = bg.evaluate_belief_gate(
        initiator_player_id="player-1",
        active_npc_id="npc-1",
        room_id="room-a",
        speak_text="让莫玄虚去对付阿斯托利亚",
        proposed_a_id="npc-1",
        proposed_b_id="npc-2",
        effective_score=-40,
        llm_judge=fake_llm,
        apply_ab_delta=fake_apply,
        day_key="day-1",
    )
    assert result.decision == "reject"
    assert result.reject_reason == "hard_threshold"
    assert result.used_llm is False
    assert llm_calls == []
    assert apply_calls == []
    assert result.affection_delta == 0
    assert result.ic_refusal_reply


def test_belief_gate_skeptical_bias_below_zero() -> None:
    """D-PLAYER-05: effectiveScore < 0 → LLM with skeptical bias."""
    llm_calls: list[dict[str, Any]] = []

    def fake_llm(**kwargs: Any) -> bg.BeliefJudgment:
        llm_calls.append(kwargs)
        return bg.BeliefJudgment(decision="reject", reason="skeptical")

    result = bg.evaluate_belief_gate(
        initiator_player_id="player-1",
        active_npc_id="npc-1",
        room_id="room-a",
        speak_text="让莫玄虚去对付阿斯托利亚",
        proposed_a_id="npc-1",
        proposed_b_id="npc-2",
        effective_score=-10,
        llm_judge=fake_llm,
        apply_ab_delta=lambda **_: None,
        day_key="day-1",
    )
    assert result.used_llm is True
    assert len(llm_calls) == 1
    assert llm_calls[0]["skeptical_bias"] is True
    assert result.decision == "reject"
    assert result.affection_delta == 0


def test_belief_reject_blocks_ab_delta_and_speaks_refusal() -> None:
    """D-PLAYER-05/06: reject → no A↔B apply; in-character refusal."""
    apply_calls: list[dict[str, Any]] = []

    def fake_llm(**kwargs: Any) -> bg.BeliefJudgment:
        return bg.BeliefJudgment(decision="reject", reason="不信")

    def fake_apply(**kwargs: Any) -> None:
        apply_calls.append(kwargs)

    result = bg.evaluate_belief_gate(
        initiator_player_id="player-1",
        active_npc_id="npc-3",
        room_id="room-a",
        speak_text="让诸葛知危去疏远糖果",
        proposed_a_id="npc-3",
        proposed_b_id="npc-4",
        effective_score=20,
        llm_judge=fake_llm,
        apply_ab_delta=fake_apply,
        day_key="day-1",
    )
    assert result.decision == "reject"
    assert apply_calls == []
    assert result.affection_delta == 0
    assert "不信" in result.ic_refusal_reply or "不便" in result.ic_refusal_reply or "插手" in result.ic_refusal_reply


def test_belief_trust_lookup_uses_initiator_player_id_only() -> None:
    """EA-5: trust keyed by initiator playerId — never peer player or npc_relationships."""
    seen: list[dict[str, Any]] = []

    def fake_lookup(**kwargs: Any) -> int:
        seen.append(kwargs)
        return 5

    score = bg.resolve_player_npc_trust(
        room_id="room-a",
        active_npc_id="npc-1",
        initiator_player_id="player-initiator",
        peer_player_id="player-other",
        fetch_effective_score=fake_lookup,
    )
    assert score == 5
    assert len(seen) == 1
    assert seen[0]["player_id"] == "player-initiator"
    assert seen[0]["npc_id"] == "npc-1"
    assert "peer" not in seen[0]
    assert "relationship" not in str(seen[0]).lower()


def test_belief_accept_clamps_player_ab_delta() -> None:
    """D-PLAYER-03: accepted player A↔B deltas clamped to |Δ| 2–6."""
    apply_calls: list[dict[str, Any]] = []

    def fake_llm(**kwargs: Any) -> bg.BeliefJudgment:
        return bg.BeliefJudgment(decision="accept", reason="ok", proposed_delta=15)

    def fake_apply(**kwargs: Any) -> None:
        apply_calls.append(kwargs)

    result = bg.evaluate_belief_gate(
        initiator_player_id="player-1",
        active_npc_id="npc-1",
        room_id="room-a",
        speak_text="让莫玄虚去对付阿斯托利亚",
        proposed_a_id="npc-1",
        proposed_b_id="npc-2",
        effective_score=40,
        llm_judge=fake_llm,
        apply_ab_delta=fake_apply,
        day_key="day-1",
    )
    assert result.decision == "accept"
    assert 2 <= abs(result.affection_delta) <= 6
    assert len(apply_calls) == 1
    assert 2 <= abs(int(apply_calls[0]["affection_delta"])) <= 6


def test_explicit_phrasing_has_higher_provoke_weight() -> None:
    """D-PLAYER-01: explicit「让 A … B」weighs higher than keyword-only."""
    soft = bg.detect_manipulation_intent("你去挑拨一下他们的关系吧")
    explicit = bg.detect_manipulation_intent("让莫玄虚去对付阿斯托利亚")
    assert soft.kind in ("provoke", "joint", "none")
    assert explicit.kind == "provoke"
    assert explicit.weight > soft.weight
    assert explicit.npc_a_id == "npc-1"
    assert explicit.npc_b_id == "npc-2"


def test_provoke_dual_caps_pair_and_player_day() -> None:
    """D-PLAYER-04 / D-VERIFY-02: per-(A,B) 1/day + per-player 3 manipulations/day."""
    apply_calls: list[dict[str, Any]] = []

    def accept_llm(**kwargs: Any) -> bg.BeliefJudgment:
        return bg.BeliefJudgment(decision="accept", reason="ok", proposed_delta=4)

    def fake_apply(**kwargs: Any) -> None:
        apply_calls.append(kwargs)

    common = dict(
        initiator_player_id="player-1",
        active_npc_id="npc-1",
        room_id="room-a",
        speak_text="让莫玄虚去对付阿斯托利亚",
        proposed_a_id="npc-1",
        proposed_b_id="npc-2",
        effective_score=50,
        llm_judge=accept_llm,
        apply_ab_delta=fake_apply,
        day_key="day-cap",
    )
    first = bg.evaluate_belief_gate(**common)
    assert first.decision == "accept"
    assert len(apply_calls) == 1

    second = bg.evaluate_belief_gate(**common)
    assert second.decision == "reject"
    assert second.reject_reason == "pair_cap"
    assert len(apply_calls) == 1

    # Different pair still allowed until player day cap (3)
    for peer in ("npc-3", "npc-4"):
        r = bg.evaluate_belief_gate(
            **{
                **common,
                "proposed_b_id": peer,
            }
        )
        assert r.decision == "accept", peer

    assert len(apply_calls) == 3

    fourth = bg.evaluate_belief_gate(
        **{
            **common,
            "proposed_b_id": "npc-5",
        }
    )
    assert fourth.decision == "reject"
    assert fourth.reject_reason == "player_cap"
    assert len(apply_calls) == 3
