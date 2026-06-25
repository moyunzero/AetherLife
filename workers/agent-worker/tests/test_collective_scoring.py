from src.collective.constants import NPC_PERSONALITY_SEED
from src.collective.scoring import (
    band_from_effective_score,
    chebyshev,
    clamp_llm_refine_delta,
    compute_effective_score,
    compute_witness_deltas,
    allowed_tools_for_band,
)


def test_compute_effective_score_golden_vectors():
    assert compute_effective_score(0, [-10, 10]) == 0
    assert compute_effective_score(90, [10, 10, 10]) == 93
    assert compute_effective_score(97, [10, 10, 10]) == 100
    assert compute_effective_score(-90, [-40, -40, -40]) == -100


def test_band_from_effective_score():
    assert band_from_effective_score(-31) == "hostile"
    assert band_from_effective_score(-1) == "wary"
    assert band_from_effective_score(10) == "neutral"
    assert band_from_effective_score(30) == "warm"
    assert band_from_effective_score(60) == "allied"


def test_clamp_llm_refine_delta():
    assert clamp_llm_refine_delta(-20) == -10
    assert clamp_llm_refine_delta(20) == 10
    assert clamp_llm_refine_delta(5) == 5


def test_witness_deltas_loud_kind():
    positions = {
        "npc-1": (2, 2),
        "npc-2": (4, 2),
        "npc-3": (8, 8),
    }
    updates = compute_witness_deltas(
        kind="rude",
        delta_score=-8,
        player_ids=["p-a"],
        target_npc_id="npc-1",
        npc_positions=positions,
    )
    assert ("npc-1", "p-a", -8) in updates
    assert ("npc-2", "p-a", -2) in updates
    assert not any(u[0] == "npc-3" for u in updates)


def test_witness_deltas_quiet_kind():
    positions = {"npc-1": (2, 2), "npc-2": (3, 2)}
    updates = compute_witness_deltas(
        kind="help",
        delta_score=6,
        player_ids=["p-a"],
        target_npc_id="npc-1",
        npc_positions=positions,
    )
    assert updates == [("npc-1", "p-a", 6)]


def test_allowed_tools_hostile():
    assert allowed_tools_for_band("hostile") == ["speak", "wait"]


def test_npc_personality_seed_twelve_way_spread():
    """D-COLLECTIVE-02: 12 council seats, non-uniform, against < for exemplars."""
    assert len(NPC_PERSONALITY_SEED) == 12
    values = list(NPC_PERSONALITY_SEED.values())
    assert len(set(values)) > 1
    assert len(set(values)) == 12
    # npc-1 (against + order_keeper) vs npc-2 (for + expansionist)
    assert NPC_PERSONALITY_SEED["npc-1"] < NPC_PERSONALITY_SEED["npc-2"]
    assert NPC_PERSONALITY_SEED["npc-1"] == -52
    assert NPC_PERSONALITY_SEED["npc-2"] == 58


def test_chebyshev():
    assert chebyshev((0, 0), (2, 1)) == 2
