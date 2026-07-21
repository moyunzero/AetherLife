"""Phase 28 belief gate for player provoke (D-PLAYER-01…06, D-VERIFY-02, EA-5/EA-6).

Uses player↔NPC trust (npc_attitudes / collective effectiveScore), not npc_relationships.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

import pytest

from src.council import belief_gate as bg
from src.council.belief_gate import TRUST_MICRO_PENALTY_MAX, TRUST_MICRO_PENALTY_MIN


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
    refusal = result.ic_refusal_reply
    assert refusal
    assert any(
        token in refusal for token in ("不信", "不便", "插手", "挑拨", "请别", "说服不了", "介入")
    )


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


def test_belief_gate_speak_node_reject_sets_ic_reply_without_apply(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Interactive path: reject → non-empty IC refusal; apply A↔B helper not called."""
    apply_calls: list[dict[str, Any]] = []

    monkeypatch.setattr(
        bg,
        "default_llm_judge",
        lambda **kwargs: bg.BeliefJudgment(decision="reject", reason="nope"),
    )

    def fake_apply(**kwargs: Any) -> None:
        apply_calls.append(kwargs)

    state = {
        "room_id": "room-a",
        "npc_id": "npc-1",
        "player_id": "player-1",
        "player_message": "让莫玄虚去对付阿斯托利亚",
        "effective_score": 25,
        "reply_draft": "好的，我去办。",
        "room_snapshot": {"gameMinute": 1500},
    }
    out = bg.run_belief_gate_speak(
        state,
        apply_ab_delta=fake_apply,
        llm_judge=lambda **k: bg.BeliefJudgment(decision="reject", reason="nope"),
    )
    assert out.get("belief_rejected") is True
    assert out.get("belief_ab_applied") is False
    reply = (out.get("reply_draft") or out.get("reply") or "").strip()
    assert reply
    assert reply != "好的，我去办。"
    assert apply_calls == []


def test_belief_gate_speak_node_accept_applies_clamped_delta() -> None:
    """Interactive accept → |Δ| in 2..6 via apply helper."""
    apply_calls: list[dict[str, Any]] = []

    def fake_apply(**kwargs: Any) -> None:
        apply_calls.append(kwargs)

    state = {
        "room_id": "room-a",
        "npc_id": "npc-1",
        "player_id": "player-1",
        "player_message": "让莫玄虚去对付阿斯托利亚",
        "effective_score": 40,
        "reply_draft": "我明白了。",
        "room_snapshot": {"gameMinute": 200},
    }
    out = bg.run_belief_gate_speak(
        state,
        apply_ab_delta=fake_apply,
        llm_judge=lambda **k: bg.BeliefJudgment(
            decision="accept", reason="ok", proposed_delta=9
        ),
    )
    assert out.get("belief_rejected") is not True
    assert out.get("belief_ab_applied") is True
    assert len(apply_calls) == 1
    assert 2 <= abs(int(apply_calls[0]["affection_delta"])) <= 6
    assert (out.get("reply_draft") or "").startswith("我明白了")


def test_interactive_graph_wires_belief_before_compose_reply() -> None:
    """Belief/provoke gate on interactive speak path — not solely memory tail."""
    import inspect

    from src.graph import npc_loop

    src = inspect.getsource(npc_loop.build_npc_interactive_graph)
    assert "belief_gate_speak" in src
    assert 'add_edge("apply_tools", "belief_gate_speak")' in src
    assert 'add_edge("belief_gate_speak", "compose_reply")' in src
    tail_src = inspect.getsource(npc_loop.run_npc_memory_tail)
    assert "maybe_trust_micro_penalty" in tail_src or "trust_micro" in tail_src
    # Memory tail must not be the sole IC-refusal path
    assert "ic_refusal_reply" not in tail_src or "belief_rejected" in tail_src


def test_joint_path_has_no_quest_escort_fsm() -> None:
    """D-PLAYER-02: joint adventure is light heuristic — no escort/quest FSM module."""
    import importlib.util

    for name in (
        "src.council.quest_fsm",
        "src.council.escort",
        "src.graph.quest_escort",
    ):
        assert importlib.util.find_spec(name) is None
    joint = bg.detect_manipulation_intent("我们一起去冒险吧")
    assert joint.kind == "joint"


def test_repeated_reject_micro_penalty_post_reply_only() -> None:
    """D-PLAYER-06: micro trust penalty only after repeated rejects (memory-tail hook)."""
    penalties: list[dict[str, Any]] = []

    def apply_trust(**kwargs: Any) -> None:
        penalties.append(kwargs)

    # First reject — no penalty
    bg.note_belief_reject(
        room_id="room-a", player_id="p1", npc_id="npc-1", day_key="d1"
    )
    d1 = bg.maybe_trust_micro_penalty(
        room_id="room-a",
        player_id="p1",
        npc_id="npc-1",
        day_key="d1",
        apply_trust_delta=apply_trust,
    )
    assert d1 == 0
    assert penalties == []

    bg.note_belief_reject(
        room_id="room-a", player_id="p1", npc_id="npc-1", day_key="d1"
    )
    d2 = bg.maybe_trust_micro_penalty(
        room_id="room-a",
        player_id="p1",
        npc_id="npc-1",
        day_key="d1",
        apply_trust_delta=apply_trust,
    )
    assert TRUST_MICRO_PENALTY_MIN <= abs(d2) <= TRUST_MICRO_PENALTY_MAX
    assert d2 < 0
    assert len(penalties) == 1
    assert penalties[0]["player_id"] == "p1"
    assert penalties[0]["npc_id"] == "npc-1"
