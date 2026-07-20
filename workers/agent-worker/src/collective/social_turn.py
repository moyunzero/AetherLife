from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from .constants import KIND_FIXED_DELTA, NPC_PERSONALITY_SEED
from .repository import CollectiveRepository
from .schemas import SOCIAL_SKIP_KIND, SocialPerception, is_social_skip

# Worker-side perception backstop (Phase 12.1 — align with rule-detector RUDE_PATTERN).
INSULT_MARKERS = (
    "粗鲁",
    "丑",
    "滚",
    "蠢",
    "有病",
    "变态",
    "活该",
    "什么玩意",
    "傻",
    "废物",
    "去死",
    "讨厌",
    "笨蛋",
    "侮辱",
    "辱骂",
)
from .scoring import (
    allowed_tools_for_band,
    band_from_effective_score,
    clamp_attitude_score,
    clamp_llm_refine_delta,
    compute_effective_score,
    compute_witness_deltas,
)


@dataclass(frozen=True)
class CollectiveApplyResult:
    applied: bool
    event_id: str | None = None
    delta_applied: int = 0
    effective_score: int | None = None
    band: str | None = None
    player_reputation: int | None = None


_HELP_OFFER_RE = re.compile(r"(?:我可以|我能|我愿意|我想|我来|让我)(?:帮|协助)")
# Avoid narrative false positives: 帮别人 / 帮腔 — require 帮 + request pronoun/cue.
_HELP_REQUEST_FALLBACK_RE = re.compile(r"帮[我你他她它个一上下把忙]")


def player_offers_help(message: str) -> bool:
    """Player volunteers to help the NPC — not a help request."""
    msg = (message or "").strip()
    if not msg:
        return False
    if _HELP_OFFER_RE.search(msg):
        return True
    if msg.startswith("我帮你"):
        return True
    if msg.startswith("帮你"):
        return True
    return False


def _message_implies_help_request(msg: str) -> bool:
    if player_offers_help(msg):
        return False
    if any(
        marker in msg
        for marker in ("帮帮我", "帮个忙", "请帮", "你能帮", "能帮我", "能请你帮", "帮忙")
    ):
        return True
    if _HELP_REQUEST_FALLBACK_RE.search(msg):
        return True
    if "请" not in msg:
        return False
    # Avoid false positives: 回复/请假 contain 请 but are not help requests.
    normalized = msg.replace("回复", "").replace("请假", "")
    return "请" in normalized


def infer_social_from_message(message: str) -> SocialPerception | None:
    """Heuristic perception when LLM marks ignore but message has clear social signal."""
    msg = message.strip()
    if not msg:
        return None
    if any(marker in msg for marker in INSULT_MARKERS):
        return SocialPerception(kind="rude", summary="玩家言语不敬", delta=-8)
    if _message_implies_help_request(msg):
        return SocialPerception(kind="help", summary="玩家请求帮助", delta=6)
    return None


def reconcile_social_perception(message: str, perception: SocialPerception) -> SocialPerception:
    """Upgrade LLM skip-kind to inferred rude/help when player text is unambiguous."""
    if not is_social_skip(perception):
        return perception
    inferred = infer_social_from_message(message)
    return inferred if inferred is not None else perception


def personality_multiplier(npc_id: str, kind: str) -> float:
    """D-06b: seed modulates sensitivity (莫玄虚 npc-1 more sensitive to insults)."""
    seed = NPC_PERSONALITY_SEED.get(npc_id, 0)
    negative_kinds = frozenset(
        {"rude", "contradict", "steal_attempt", "compete_object", "betray", "ignore"},
    )
    positive_kinds = frozenset(
        {"polite", "help", "collaborate", "gift", "praise", "apologize"},
    )
    if kind in negative_kinds:
        mult = 1.0 - seed * 0.02
    elif kind in positive_kinds:
        mult = 1.0 + seed * 0.02
    else:
        mult = 1.0
    return max(0.8, min(1.3, mult))


def compute_applied_delta(npc_id: str, kind: str) -> int:
    base = KIND_FIXED_DELTA.get(kind, 0)
    mult = personality_multiplier(npc_id, kind)
    return clamp_llm_refine_delta(round(base * mult))


def apply_social_from_llm(
    *,
    room_id: str,
    npc_id: str,
    player_id: str,
    perception: SocialPerception,
    npc_positions: dict[str, tuple[int, int]] | None = None,
    repo: CollectiveRepository | None = None,
) -> CollectiveApplyResult:
    if is_social_skip(perception):
        return CollectiveApplyResult(applied=False)

    kind = perception.kind
    delta_applied = compute_applied_delta(npc_id, kind)
    summary = perception.summary[:80] or f"玩家社交：{kind}"
    repository = repo or CollectiveRepository()

    event_id = repository.insert_worker_event(
        room_id=room_id,
        npc_id=npc_id,
        kind=kind,
        summary=summary,
        player_ids=[player_id],
        delta_score=delta_applied,
        npc_positions=npc_positions or {},
    )
    repository.prune_expired()

    player_rep = repository.get_attitude(room_id, npc_id, player_id)
    if player_rep is None:
        player_rep = NPC_PERSONALITY_SEED.get(npc_id, 0)

    window_deltas = repository.list_window_deltas(room_id, npc_id)
    effective = compute_effective_score(float(player_rep), window_deltas)
    band = band_from_effective_score(effective)

    return CollectiveApplyResult(
        applied=True,
        event_id=event_id,
        delta_applied=delta_applied,
        effective_score=effective,
        band=band,
        player_reputation=player_rep,
    )


def refresh_collective_snapshot(
    state: dict[str, Any],
    apply_result: CollectiveApplyResult | None = None,
) -> dict[str, Any]:
    """Merge apply result or re-read fields into graph state for compose_reply."""
    out = dict(state)
    if apply_result is None or not apply_result.applied:
        return out

    if apply_result.band is not None:
        out["attitude_band"] = apply_result.band
    if apply_result.effective_score is not None:
        out["effective_score"] = apply_result.effective_score
    if apply_result.band is not None:
        out["allowed_tools"] = allowed_tools_for_band(apply_result.band)

    summary = (state.get("social_perception") or {}).get("summary")
    if isinstance(summary, str) and summary.strip():
        existing = list(out.get("collective_summaries") or [])
        out["collective_summaries"] = [summary.strip(), *existing[:4]]

    out["collective_updated"] = True
    return out


def npc_positions_from_room(room: dict[str, Any]) -> dict[str, tuple[int, int]]:
    positions: dict[str, tuple[int, int]] = {}
    for npc in room.get("npcs") or []:
        npc_id = npc.get("id")
        if not npc_id:
            continue
        positions[str(npc_id)] = (int(npc.get("x") or 0), int(npc.get("y") or 0))
    return positions
