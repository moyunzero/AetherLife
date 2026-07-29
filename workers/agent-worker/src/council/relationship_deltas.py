"""Relationship delta engine from debate/vote outcomes (REL-03, REL-05)."""

from __future__ import annotations

import random
from typing import Any, TypedDict

from src.council.constants import COUNCIL_NPC_IDS, HISTORY_SUMMARY_DELTA_THRESHOLD, RELATIONSHIP_DELTA_ABS_MAX
from src.council.registry import ARCHETYPE_CHANGE_RATE, display_name, get_persona


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
    statusTags: list[str]


MEETING_EDGE_CAP = 20


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


def _display_name_to_id() -> dict[str, str]:
    mapping: dict[str, str] = {}
    for npc_id in COUNCIL_NPC_IDS:
        name = display_name(npc_id)
        if name:
            mapping[name] = npc_id
    return mapping


def _debate_interaction_pairs(
    transcript: list[DebateUtterance],
) -> set[tuple[str, str]]:
    """P1a: undirected pairs when utterance mentions another seat displayName."""
    name_to_id = _display_name_to_id()
    pairs: set[tuple[str, str]] = set()
    by_round: dict[int, list[DebateUtterance]] = {}
    for line in transcript:
        by_round.setdefault(line["round"], []).append(line)

    round_nums = sorted(by_round.keys())
    for idx, round_num in enumerate(round_nums):
        utterances = by_round[round_num]
        for utterance in utterances:
            speaker = utterance["npcId"]
            text = utterance["text"]
            for name, other_id in name_to_id.items():
                if other_id == speaker or name not in text:
                    continue
                pairs.add(_normalize_edge(speaker, other_id))
        if idx + 1 >= len(round_nums):
            continue
        next_utterances = by_round[round_nums[idx + 1]]
        for left in utterances:
            left_name = display_name(left["npcId"])
            for right in next_utterances:
                if left["npcId"] == right["npcId"]:
                    continue
                right_name = display_name(right["npcId"])
                if left_name and left_name in right["text"]:
                    pairs.add(_normalize_edge(left["npcId"], right["npcId"]))
                if right_name and right_name in left["text"]:
                    pairs.add(_normalize_edge(left["npcId"], right["npcId"]))
    return pairs


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


def _proposer_voter_deltas(
    proposer_id: str,
    ballots: list[Ballot],
) -> dict[tuple[str, str], int]:
    """Proposer↔voter edges from final ballot (ISSUE-061)."""
    bucket: dict[tuple[str, str], int] = {}
    for ballot in ballots:
        voter_id = ballot["npcId"]
        if voter_id == proposer_id:
            continue
        if ballot["vote"] == "yes":
            _accumulate(bucket, proposer_id, voter_id, random.randint(3, 8))
        else:
            _accumulate(bucket, proposer_id, voter_id, -random.randint(8, 15))
    return bucket


def _vote_deltas(
    ballots: list[Ballot],
    proposer_id: str,
    interaction_pairs: set[tuple[str, str]],
) -> dict[tuple[str, str], int]:
    """Voter↔voter deltas only when debate interaction exists — no O(n²) mesh."""
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
            key = _normalize_edge(a, b)
            if key in interaction_pairs:
                _accumulate(bucket, a, b, random.randint(3, 8))

    for a in no_ids:
        for b in no_ids:
            if a >= b:
                continue
            key = _normalize_edge(a, b)
            if key in interaction_pairs:
                _accumulate(bucket, a, b, random.randint(3, 8))

    for y in yes_ids:
        for n in no_ids:
            key = _normalize_edge(y, n)
            if key in interaction_pairs:
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

    interaction_pairs = _debate_interaction_pairs(debate_transcript)
    debate_deltas = _debate_disagreement_deltas(debate_transcript)
    for key in debate_deltas:
        interaction_pairs.add(key)

    combined: dict[tuple[str, str], int] = {}
    for source in (
        debate_deltas,
        _proposer_voter_deltas(proposer_id, ballots),
        _vote_deltas(ballots, proposer_id, interaction_pairs),
    ):
        for key, delta in source.items():
            combined[key] = combined.get(key, 0) + delta

    for key in combined:
        combined[key] = max(-MEETING_EDGE_CAP, min(MEETING_EDGE_CAP, combined[key]))

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


def filter_linked_edges_for_ui(
    deltas: list[RelationshipDelta],
    *,
    top_k: int = 8,
    min_abs: int = HISTORY_SUMMARY_DELTA_THRESHOLD,
) -> list[dict[str, str]]:
    """UI hint subset: Top-K edges with |Δ|≥min_abs (REL-05)."""
    notable = [d for d in deltas if abs(int(d.get("affectionDelta") or 0)) >= min_abs]
    notable.sort(key=lambda d: abs(int(d["affectionDelta"])), reverse=True)
    trimmed = notable[:top_k]
    return [{"npcAId": d["npcAId"], "npcBId": d["npcBId"]} for d in trimmed]


def iter_rel07_trigger_deltas(deltas: list[RelationshipDelta]) -> list[RelationshipDelta]:
    """REL-07: edges that warrant bilateral personal-timeline jobs.

    Trigger when |affectionDelta| ≥ HISTORY_SUMMARY_DELTA_THRESHOLD (8),
    or when statusTags are present on the delta (status change).
    """
    out: list[RelationshipDelta] = []
    for delta in deltas:
        affection = abs(int(delta.get("affectionDelta") or 0))
        status_tags = delta.get("statusTags") or []
        if affection >= HISTORY_SUMMARY_DELTA_THRESHOLD or bool(status_tags):
            out.append(delta)
    return out


def linked_edges_from_deltas(deltas: list[RelationshipDelta]) -> list[dict[str, str]]:
    return [{"npcAId": d["npcAId"], "npcBId": d["npcBId"]} for d in deltas if d.get("affectionDelta")]


def clamp_player_provoke_delta(delta: int) -> int:
    """D-PLAYER-03: player provoke/joint edge |Δ| clamped to 2–6."""
    from src.council.belief_gate import clamp_player_ab_delta

    return clamp_player_ab_delta(delta)
