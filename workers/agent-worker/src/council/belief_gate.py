"""Player provoke / joint-adventure belief gate (D-PLAYER-01…06, EA-5/EA-6).

Planner-locked cutoffs (Open Q2 / 28-01):
  effectiveScore < -30 → hard reject without LLM
  effectiveScore < 0  → LLM judgment with skeptical bias
  effectiveScore >= 0 → LLM believe / reject / skeptical

Trust source: npc_attitudes / collective effectiveScore for
(room, activeNpc, initiatorPlayerId) only — NEVER npc_relationships (EA-5).

Reject → no A↔B relationship delta (EA-6). Accepted player A↔B |Δ| clamped to 2–6.
"""

from __future__ import annotations

import os
import random
import re
from dataclasses import dataclass
from typing import Any, Callable, Literal

from src.council.registry import display_name
from src.council.constants import COUNCIL_NPC_IDS

# Planner-locked belief cutoffs
HARD_REJECT_THRESHOLD = -30
SKEPTICAL_BIAS_THRESHOLD = 0

# D-PLAYER-03
PLAYER_AB_DELTA_MIN = 2
PLAYER_AB_DELTA_MAX = 6

# D-PLAYER-06 micro trust penalty
TRUST_MICRO_PENALTY_MIN = 1
TRUST_MICRO_PENALTY_MAX = 3

# D-PLAYER-04 dual caps
PAIR_CAP_PER_DAY = 1
PLAYER_CAP_PER_DAY = 3

Decision = Literal["accept", "reject", "none"]
RejectReason = Literal[
    "hard_threshold",
    "llm_reject",
    "pair_cap",
    "player_cap",
    "not_manipulation",
    "",
]

IC_REFUSAL_TEMPLATES = (
    "这话我不太信。你们之间的事，我不便插手。",
    "我不会按你说的去挑拨他们。请别再试了。",
    "你的说辞说服不了我——我不会介入他们的关系。",
)

_PROVOKE_KEYWORDS = (
    "挑拨",
    "离间",
    "对付",
    "疏远",
    "仇恨",
    "反目",
    "作对",
    "陷害",
)
_JOINT_KEYWORDS = (
    "一起去",
    "共同冒险",
    "一起冒险",
    "陪我去",
    "结伴",
    "同行一趟",
)

# In-process dual-cap claims: (scope, day_key, id) → count
_pair_claims: dict[tuple[str, str, str], int] = {}
_player_claims: dict[tuple[str, str, str], int] = {}
_reject_counts: dict[tuple[str, str, str, str], int] = {}
_trust_penalty_claims: dict[tuple[str, str, str, str], int] = {}


def clear_manipulation_caps_for_test() -> None:
    _pair_claims.clear()
    _player_claims.clear()
    _reject_counts.clear()
    _trust_penalty_claims.clear()


def _prune_stale_day_keys(current_day_key: str) -> None:
    """Drop in-process cap entries from prior game days (long-running worker)."""
    for store in (_pair_claims, _player_claims):
        stale = [key for key in store if key[1] != current_day_key]
        for key in stale:
            del store[key]
    for store in (_reject_counts, _trust_penalty_claims):
        stale = [key for key in store if key[1] != current_day_key]
        for key in stale:
            del store[key]


@dataclass(frozen=True)
class ManipulationIntent:
    kind: Literal["provoke", "joint", "none"]
    weight: float
    npc_a_id: str | None = None
    npc_b_id: str | None = None


@dataclass(frozen=True)
class BeliefJudgment:
    decision: Literal["accept", "reject"]
    reason: str = ""
    proposed_delta: int = 4


@dataclass
class BeliefGateResult:
    decision: Decision
    reject_reason: RejectReason = ""
    used_llm: bool = False
    skeptical_bias: bool = False
    affection_delta: int = 0
    ic_refusal_reply: str = ""
    npc_a_id: str | None = None
    npc_b_id: str | None = None
    kind: Literal["provoke", "joint", "none"] = "none"


def clamp_player_ab_delta(delta: int) -> int:
    """D-PLAYER-03: player-triggered edge |Δ| in 2–6."""
    if delta == 0:
        delta = PLAYER_AB_DELTA_MIN
    sign = -1 if delta < 0 else 1
    mag = abs(int(delta))
    mag = max(PLAYER_AB_DELTA_MIN, min(PLAYER_AB_DELTA_MAX, mag))
    return sign * mag


def ic_refusal_reply(*, seed: str = "") -> str:
    """Deterministic IC refusal for speak turn (UI-SPEC: in-dialogue only)."""
    if not seed:
        return IC_REFUSAL_TEMPLATES[0]
    idx = sum(ord(c) for c in seed) % len(IC_REFUSAL_TEMPLATES)
    return IC_REFUSAL_TEMPLATES[idx]


def _name_to_id() -> dict[str, str]:
    mapping: dict[str, str] = {}
    for npc_id in COUNCIL_NPC_IDS:
        name = display_name(npc_id)
        if name:
            mapping[name] = npc_id
    return mapping


def _normalize_pair(a: str, b: str) -> tuple[str, str]:
    return (a, b) if a < b else (b, a)


def detect_manipulation_intent(speak_text: str) -> ManipulationIntent:
    """D-PLAYER-01/02: keyword + explicit「让 A … B」; joint = shared adventure phrasing."""
    text = (speak_text or "").strip()
    if not text:
        return ManipulationIntent(kind="none", weight=0.0)

    name_map = _name_to_id()
    # Prefer longer names first when scanning, but assign A/B by first appearance in text.
    appearances: list[tuple[int, str]] = []
    for name, npc_id in sorted(name_map.items(), key=lambda x: -len(x[0])):
        idx = text.find(name)
        if idx >= 0 and npc_id not in {n for _, n in appearances}:
            appearances.append((idx, npc_id))
    appearances.sort(key=lambda x: x[0])
    found_ids = [npc_id for _, npc_id in appearances]

    # Explicit「让 A … B」— higher weight
    explicit_match = re.search(r"让(.{1,12}?)(?:去|来)?(?:对付|疏远|离间|挑拨|为难)", text)
    if explicit_match and len(found_ids) >= 2:
        return ManipulationIntent(
            kind="provoke",
            weight=2.0,
            npc_a_id=found_ids[0],
            npc_b_id=found_ids[1],
        )
    if "让" in text and len(found_ids) >= 2 and any(k in text for k in _PROVOKE_KEYWORDS):
        return ManipulationIntent(
            kind="provoke",
            weight=2.0,
            npc_a_id=found_ids[0],
            npc_b_id=found_ids[1],
        )

    if any(k in text for k in _PROVOKE_KEYWORDS):
        a = found_ids[0] if found_ids else None
        b = found_ids[1] if len(found_ids) > 1 else None
        return ManipulationIntent(kind="provoke", weight=1.0, npc_a_id=a, npc_b_id=b)

    if any(k in text for k in _JOINT_KEYWORDS):
        a = found_ids[0] if found_ids else None
        b = found_ids[1] if len(found_ids) > 1 else None
        return ManipulationIntent(kind="joint", weight=1.0, npc_a_id=a, npc_b_id=b)

    return ManipulationIntent(kind="none", weight=0.0)


def resolve_player_npc_trust(
    *,
    room_id: str,
    active_npc_id: str,
    initiator_player_id: str,
    peer_player_id: str | None = None,
    fetch_effective_score: Callable[..., int] | None = None,
    effective_score: int | None = None,
) -> int:
    """EA-5: player↔NPC trust via attitudes/collective — initiator playerId only.

    ``peer_player_id`` is accepted only to assert callers do not use it for lookup.
    """
    del peer_player_id  # never used for trust (EA-5)
    if effective_score is not None:
        return int(effective_score)
    if fetch_effective_score is None:
        return 0
    return int(
        fetch_effective_score(
            room_id=room_id,
            npc_id=active_npc_id,
            player_id=initiator_player_id,
        )
    )


def default_llm_judge(
    *,
    speak_text: str,
    effective_score: int,
    skeptical_bias: bool,
    llm_mock: bool | None = None,
) -> BeliefJudgment:
    """LLM believe/reject/skeptical JSON judgment. LLM_MOCK is deterministic."""
    mock = llm_mock if llm_mock is not None else (
        os.getenv("LLM_MOCK") == "1"
    )
    if mock:
        # Skeptical bias → reject under mock; non-skeptical with score≥0 → accept
        if skeptical_bias:
            return BeliefJudgment(decision="reject", reason="skeptical_mock", proposed_delta=0)
        if effective_score >= SKEPTICAL_BIAS_THRESHOLD:
            return BeliefJudgment(decision="accept", reason="trust_mock", proposed_delta=4)
        return BeliefJudgment(decision="reject", reason="low_trust_mock", proposed_delta=0)

    # Real LLM judge not wired yet — guardrail-consistent reject, never silent accept.
    del speak_text
    if skeptical_bias and effective_score < 10:
        return BeliefJudgment(decision="reject", reason="skeptical_fallback", proposed_delta=0)
    return BeliefJudgment(decision="reject", reason="llm_judge_unwired", proposed_delta=0)


def _pair_key(room_id: str, a: str, b: str) -> str:
    na, nb = _normalize_pair(a, b)
    return f"{room_id}:{na}:{nb}"


def claim_manipulation_slot(
    *,
    room_id: str,
    player_id: str,
    npc_a_id: str,
    npc_b_id: str,
    day_key: str,
) -> RejectReason | None:
    """D-PLAYER-04: per-(A,B) 1/day + per-player 3/day. Returns reject reason or None."""
    _prune_stale_day_keys(day_key)
    pair = _pair_key(room_id, npc_a_id, npc_b_id)
    pair_claim_key = (room_id, day_key, pair)
    player_claim_key = (room_id, day_key, player_id)

    if _pair_claims.get(pair_claim_key, 0) >= PAIR_CAP_PER_DAY:
        return "pair_cap"
    if _player_claims.get(player_claim_key, 0) >= PLAYER_CAP_PER_DAY:
        return "player_cap"

    _pair_claims[pair_claim_key] = _pair_claims.get(pair_claim_key, 0) + 1
    _player_claims[player_claim_key] = _player_claims.get(player_claim_key, 0) + 1
    return None


def note_belief_reject(
    *,
    room_id: str,
    player_id: str,
    npc_id: str,
    day_key: str,
) -> int:
    """Count repeated rejects same day for micro trust penalty (D-PLAYER-06)."""
    _prune_stale_day_keys(day_key)
    key = (room_id, day_key, player_id, npc_id)
    _reject_counts[key] = _reject_counts.get(key, 0) + 1
    return _reject_counts[key]


def maybe_trust_micro_penalty(
    *,
    room_id: str,
    player_id: str,
    npc_id: str,
    day_key: str,
    apply_trust_delta: Callable[..., None] | None = None,
) -> int:
    """Post-reply only: repeated reject → player↔NPC trust |Δ| 1–3 with daily cap."""
    key = (room_id, day_key, player_id, npc_id)
    rejects = _reject_counts.get(key, 0)
    if rejects < 2:
        return 0
    penalty_key = key
    if _trust_penalty_claims.get(penalty_key, 0) >= 1:
        return 0
    delta = -random.randint(TRUST_MICRO_PENALTY_MIN, TRUST_MICRO_PENALTY_MAX)
    _trust_penalty_claims[penalty_key] = 1
    if apply_trust_delta is not None:
        apply_trust_delta(
            room_id=room_id,
            npc_id=npc_id,
            player_id=player_id,
            delta=delta,
        )
    return delta


def evaluate_belief_gate(
    *,
    initiator_player_id: str,
    active_npc_id: str,
    room_id: str,
    speak_text: str,
    proposed_a_id: str | None,
    proposed_b_id: str | None,
    effective_score: int,
    day_key: str = "day-0",
    llm_judge: Callable[..., BeliefJudgment] | None = None,
    apply_ab_delta: Callable[..., None] | None = None,
    intent: ManipulationIntent | None = None,
) -> BeliefGateResult:
    """Hybrid belief gate. Reject never calls apply_ab_delta (EA-6)."""
    detected = intent or detect_manipulation_intent(speak_text)
    if detected.kind == "none" and not (proposed_a_id and proposed_b_id):
        return BeliefGateResult(decision="none", kind="none")

    kind = detected.kind if detected.kind != "none" else "provoke"
    npc_a = proposed_a_id or detected.npc_a_id
    npc_b = proposed_b_id or detected.npc_b_id
    if not npc_a or not npc_b or npc_a == npc_b:
        # Need a pair for A↔B; still allow reject reply on hard threshold provoke
        if detected.kind == "none":
            return BeliefGateResult(decision="none", kind="none")

    score = int(effective_score)
    refusal = ic_refusal_reply(seed=f"{room_id}:{initiator_player_id}:{speak_text}")

    # Hard reject — no LLM
    if score < HARD_REJECT_THRESHOLD:
        note_belief_reject(
            room_id=room_id,
            player_id=initiator_player_id,
            npc_id=active_npc_id,
            day_key=day_key,
        )
        return BeliefGateResult(
            decision="reject",
            reject_reason="hard_threshold",
            used_llm=False,
            skeptical_bias=False,
            affection_delta=0,
            ic_refusal_reply=refusal,
            npc_a_id=npc_a,
            npc_b_id=npc_b,
            kind=kind,  # type: ignore[arg-type]
        )

    skeptical = score < SKEPTICAL_BIAS_THRESHOLD
    judge_fn = llm_judge or default_llm_judge
    judgment = judge_fn(
        speak_text=speak_text,
        effective_score=score,
        skeptical_bias=skeptical,
    )
    used_llm = True

    if judgment.decision == "reject":
        note_belief_reject(
            room_id=room_id,
            player_id=initiator_player_id,
            npc_id=active_npc_id,
            day_key=day_key,
        )
        return BeliefGateResult(
            decision="reject",
            reject_reason="llm_reject",
            used_llm=used_llm,
            skeptical_bias=skeptical,
            affection_delta=0,
            ic_refusal_reply=refusal,
            npc_a_id=npc_a,
            npc_b_id=npc_b,
            kind=kind,  # type: ignore[arg-type]
        )

    # Accept path — dual caps before apply
    if not npc_a or not npc_b:
        return BeliefGateResult(
            decision="reject",
            reject_reason="not_manipulation",
            used_llm=used_llm,
            skeptical_bias=skeptical,
            affection_delta=0,
            ic_refusal_reply=refusal,
            kind=kind,  # type: ignore[arg-type]
        )

    cap_reject = claim_manipulation_slot(
        room_id=room_id,
        player_id=initiator_player_id,
        npc_a_id=npc_a,
        npc_b_id=npc_b,
        day_key=day_key,
    )
    if cap_reject:
        note_belief_reject(
            room_id=room_id,
            player_id=initiator_player_id,
            npc_id=active_npc_id,
            day_key=day_key,
        )
        return BeliefGateResult(
            decision="reject",
            reject_reason=cap_reject,
            used_llm=used_llm,
            skeptical_bias=skeptical,
            affection_delta=0,
            ic_refusal_reply=refusal,
            npc_a_id=npc_a,
            npc_b_id=npc_b,
            kind=kind,  # type: ignore[arg-type]
        )

    delta = clamp_player_ab_delta(int(judgment.proposed_delta or 4))
    if apply_ab_delta is not None:
        apply_ab_delta(
            room_id=room_id,
            npc_a_id=npc_a,
            npc_b_id=npc_b,
            affection_delta=delta,
            initiator_player_id=initiator_player_id,
        )

    return BeliefGateResult(
        decision="accept",
        reject_reason="",
        used_llm=used_llm,
        skeptical_bias=skeptical,
        affection_delta=delta,
        ic_refusal_reply="",
        npc_a_id=npc_a,
        npc_b_id=npc_b,
        kind=kind,  # type: ignore[arg-type]
    )


def day_key_from_snapshot(room_snapshot: dict[str, Any] | None) -> str:
    snap = room_snapshot or {}
    # Prefer monotonic absoluteGameMinute (worker-state CR PR#22); fall back to wrapped gameMinute.
    abs_minute = snap.get("absoluteGameMinute")
    if abs_minute is not None:
        minute = int(abs_minute)
    else:
        minute = int(snap.get("gameMinute") or snap.get("game_minute") or 0)
    return f"day-{minute // 1440}"


def run_belief_gate_speak(
    state: dict[str, Any],
    *,
    settings: Any | None = None,
    client: Any | None = None,
    apply_ab_delta: Callable[..., None] | None = None,
    llm_judge: Callable[..., BeliefJudgment] | None = None,
    enqueue_rel07: Callable[..., list] | None = None,
) -> dict[str, Any]:
    """Interactive speak hook — run BEFORE compose_reply finalizes player-visible reply.

    Never call from Colyseus onMessage speak. Reject forces IC refusal as reply_draft.
    Accept applies A↔B via apply_ab_delta (or HTTP when client+settings provided).
    """
    from src.council.relationship_deltas import clamp_player_provoke_delta

    player_message = (state.get("player_message") or "").strip()
    intent = detect_manipulation_intent(player_message)
    if intent.kind == "none":
        return {**state, "manipulation_intent": "none"}

    room_id = str(state.get("room_id") or "")
    npc_id = str(state.get("npc_id") or "npc-1")
    player_id = str(state.get("player_id") or "__legacy__")
    score_raw = state.get("effective_score")
    score = int(score_raw) if isinstance(score_raw, (int, float)) else 0
    day_key = day_key_from_snapshot(state.get("room_snapshot"))

    apply_fn = apply_ab_delta
    if apply_fn is None and client is not None and settings is not None:
        from src.graph.personal_timeline import (
            DYAD_REL_MIN_ABS_DELTA,
            apply_single_relationship_delta,
            enqueue_rel07_bilateral_jobs,
        )

        def apply_fn(**kwargs: Any) -> None:
            delta = clamp_player_provoke_delta(int(kwargs["affection_delta"]))
            apply_single_relationship_delta(
                client,
                settings,
                room_id=kwargs["room_id"],
                npc_a_id=kwargs["npc_a_id"],
                npc_b_id=kwargs["npc_b_id"],
                affection_delta=delta,
                history_append=f"玩家促成互动（Δ{delta:+d}）",
            )
            rel_fn = enqueue_rel07 or enqueue_rel07_bilateral_jobs
            snap = state.get("room_snapshot") or {}
            epoch = int(snap.get("absoluteGameMinute") or snap.get("gameMinute") or 0)
            rel_fn(
                room_id=kwargs["room_id"],
                npc_a_id=kwargs["npc_a_id"],
                npc_b_id=kwargs["npc_b_id"],
                event_anchor_id=f"provoke-{day_key}-{kwargs['npc_a_id']}-{kwargs['npc_b_id']}",
                affection_delta=delta,
                aether_epoch_minute=epoch,
                history_append=f"玩家促成互动（Δ{delta:+d}）",
                min_abs_delta=DYAD_REL_MIN_ABS_DELTA,
                settings=settings,
            )

    result = evaluate_belief_gate(
        initiator_player_id=player_id,
        active_npc_id=npc_id,
        room_id=room_id,
        speak_text=player_message,
        proposed_a_id=intent.npc_a_id,
        proposed_b_id=intent.npc_b_id,
        effective_score=score,
        day_key=day_key,
        llm_judge=llm_judge,
        apply_ab_delta=apply_fn,
        intent=intent,
    )

    out = {
        **state,
        "manipulation_intent": intent.kind,
        "belief_decision": result.decision,
        "belief_rejected": result.decision == "reject",
        "belief_ab_applied": result.decision == "accept" and result.affection_delta != 0,
        "belief_day_key": day_key,
    }
    if result.decision == "reject":
        refusal = result.ic_refusal_reply or ic_refusal_reply(seed=player_message)
        out["reply_draft"] = refusal
        out["reply"] = refusal
        out["belief_ab_applied"] = False
    return out


def belief_gate_speak_node(
    state: dict[str, Any],
    *,
    settings: Any,
    client: Any,
) -> dict[str, Any]:
    """LangGraph node wrapper (httpx client injected by _with_client_node)."""
    return run_belief_gate_speak(state, settings=settings, client=client)
