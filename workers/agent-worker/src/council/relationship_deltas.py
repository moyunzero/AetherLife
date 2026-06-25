"""Relationship delta engine from debate/vote outcomes (REL-03, REL-05)."""

from __future__ import annotations

import random
from typing import Any, TypedDict

from src.council.constants import COUNCIL_NPC_IDS, HISTORY_SUMMARY_DELTA_THRESHOLD, RELATIONSHIP_DELTA_ABS_MAX
from src.council.registry import ARCHETYPE_CHANGE_RATE, get_persona


class DebateUtterance(TypedDict):
    npcId: str
    text: str
    round: int


class Ballot(TypedDict):
    npcId: str
    vote: str
    reasonZh: str


class RelationshipDelta(TypedDict, total=False):
    npcAId: str
    npcBId: str
    affectionDelta: int
    historyAppend: str


def _normalize_edge(npc_a: str, npc_b: str) -> tuple[str, str]:
    if npc_a == npc_b:
        raise ValueError("edge ids must differ")
    return (npc_a, npc_b) if npc_a < npc_b else (npc_b, npc_a)


def _clamp_delta(delta: int) -> int:
    if delta == 0:
        return 0
    sign = -1 if delta < 0 else 1
    return sign * min(RELATIONSHIP_DELTA_ABS_MAX, abs(delta))


def _scale_delta(base: int, npc_a: str, npc_b: str) -> int:
    persona_a = get_persona(npc_a)
    persona_b = get_persona(npc_b)
    rate_a = ARCHETYPE_CHANGE_RATE.get(persona_a["archetype"], 1.0) if persona_a else 1.0
    rate_b = ARCHETYPE_CHANGE_RATE.get(persona_b["archetype"], 1.0) if persona_b else 1.0
    rate = (rate_a + rate_b) / 2.0
    if persona_a and persona_a["archetype"] == "mediator" and base > 0:
        rate *= 1.2
    scaled = int(round(base * rate))
    return _clamp_delta(scaled)


def _accumulate(
    bucket: dict[tuple[str, str], int],
    npc_a: str,
    npc_b: str,
    delta: int,
) -> None:
    if delta == 0 or npc_a == npc_b:
        return
    key = _normalize_edge(npc_a, npc_b)
    bucket[key] = bucket.get(key, 0) + _scale_delta(delta, key[0], key[1])


def _debate_disagreement_deltas(
    transcript: list[DebateUtterance],
) -> dict[tuple[str, str], int]:
    """Same round, opposing stance keywords → affection delta magnitude 5–15."""
    bucket: dict[tuple[str, str], int] = {}
    oppose_markers = ("反对", "不可", "荒唐", "危险", "否决", "不行")
    support_markers = ("赞成", "支持", "同意", "可行", "必要")

    by_round: dict[int, list[DebateUtterance]] = {}
    for line in transcript:
        by_round.setdefault(line["round"], []).append(line)

    for utterances in by_round.values():
        supporters = [u for u in utterances if any(m in u["text"] for m in support_markers)]
        opposers = [u for u in utterances if any(m in u["text"] for m in oppose_markers)]
        if not supporters or not opposers:
            continue
        for s in supporters:
            for o in opposers:
                if s["npcId"] == o["npcId"]:
                    continue
                magnitude = random.randint(5, 15)
                _accumulate(bucket, s["npcId"], o["npcId"], -magnitude)
    return bucket


def _vote_deltas(ballots: list[Ballot], proposer_id: str) -> dict[tuple[str, str], int]:
    """Same-side +3..8; opposing -8..20."""
    bucket: dict[tuple[str, str], int] = {}
    non_proposer = [b for b in ballots if b["npcId"] != proposer_id]
    if len(non_proposer) < 2:
        return bucket

    yes_ids = {b["npcId"] for b in non_proposer if b["vote"] == "yes"}
    no_ids = {b["npcId"] for b in non_proposer if b["vote"] == "no"}

    for a in yes_ids:
        for b in yes_ids:
            if a >= b:
                continue
            _accumulate(bucket, a, b, random.randint(3, 8))

    for a in no_ids:
        for b in no_ids:
            if a >= b:
                continue
            _accumulate(bucket, a, b, random.randint(3, 8))

    for y in yes_ids:
        for n in no_ids:
            _accumulate(bucket, y, n, -random.randint(8, 20))

    return bucket


def compute_relationship_deltas(
    debate_transcript: list[DebateUtterance],
    ballots: list[Ballot],
    proposer_id: str,
    *,
    seed: int | None = None,
) -> list[RelationshipDelta]:
    """Return delta inputs for apply-deltas; non-zero edges only."""
    if seed is not None:
        random.seed(seed)

    combined: dict[tuple[str, str], int] = {}
    for source in (_debate_disagreement_deltas(debate_transcript), _vote_deltas(ballots, proposer_id)):
        for key, delta in source.items():
            combined[key] = combined.get(key, 0) + delta

    results: list[RelationshipDelta] = []
    for (npc_a, npc_b), raw_delta in combined.items():
        delta = _clamp_delta(raw_delta)
        if delta == 0:
            continue
        entry: RelationshipDelta = {
            "npcAId": npc_a,
            "npcBId": npc_b,
            "affectionDelta": delta,
        }
        if abs(delta) >= HISTORY_SUMMARY_DELTA_THRESHOLD:
            direction = "亲近" if delta > 0 else "疏远"
            entry["historyAppend"] = f"廷议后{direction}（Δ{delta:+d}）"
        results.append(entry)
    return results


def linked_edges_from_deltas(deltas: list[RelationshipDelta]) -> list[dict[str, str]]:
    return [{"npcAId": d["npcAId"], "npcBId": d["npcBId"]} for d in deltas if d.get("affectionDelta")]
