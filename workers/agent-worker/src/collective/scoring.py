from __future__ import annotations

from .constants import (
    COLLECTIVE_WINDOW_MEAN_WEIGHT,
    LOUD_KINDS,
    WITNESS_CHEBYSHEV_MAX,
    WITNESS_DELTA_FRACTION,
    LLM_REFINE_DELTA_MAX,
    LLM_REFINE_DELTA_MIN,
)

ATTITUDE_SCORE_MIN = -100
ATTITUDE_SCORE_MAX = 100


def clamp_attitude_score(score: float) -> int:
    return max(ATTITUDE_SCORE_MIN, min(ATTITUDE_SCORE_MAX, round(score)))


def band_from_effective_score(score: float) -> str:
    if score < -30:
        return "hostile"
    if score < 0:
        return "wary"
    if score < 20:
        return "neutral"
    if score < 50:
        return "warm"
    return "allied"


def compute_effective_score(initiator_rep: float, window_deltas: list[int]) -> int:
    mean = 0.0 if not window_deltas else sum(window_deltas) / len(window_deltas)
    return clamp_attitude_score(initiator_rep + COLLECTIVE_WINDOW_MEAN_WEIGHT * mean)


def clamp_llm_refine_delta(delta: int) -> int:
    return max(LLM_REFINE_DELTA_MIN, min(LLM_REFINE_DELTA_MAX, round(delta)))


def chebyshev(a: tuple[int, int], b: tuple[int, int]) -> int:
    return max(abs(a[0] - b[0]), abs(a[1] - b[1]))


def compute_witness_deltas(
    *,
    kind: str,
    delta_score: int,
    player_ids: list[str],
    target_npc_id: str,
    npc_positions: dict[str, tuple[int, int]],
) -> list[tuple[str, str, int]]:
    updates: list[tuple[str, str, int]] = []
    target_pos = npc_positions.get(target_npc_id)
    for player_id in player_ids:
        updates.append((target_npc_id, player_id, delta_score))
        if kind not in LOUD_KINDS or target_pos is None:
            continue
        for witness_id, pos in npc_positions.items():
            if witness_id == target_npc_id:
                continue
            if chebyshev(pos, target_pos) > WITNESS_CHEBYSHEV_MAX:
                continue
            updates.append(
                (witness_id, player_id, round(delta_score * WITNESS_DELTA_FRACTION)),
            )
    return updates


def allowed_tools_for_band(band: str) -> list[str]:
    from .constants import ALL_ALLOWED_TOOLS, HOSTILE_ALLOWED_TOOLS

    if band == "hostile":
        return list(HOSTILE_ALLOWED_TOOLS)
    return list(ALL_ALLOWED_TOOLS)
