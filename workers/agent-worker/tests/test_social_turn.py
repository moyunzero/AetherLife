import os

import pytest

from src.collective.repository import CollectiveRepository, reset_in_memory_store
from src.collective.schemas import SocialPerception, SocialTurnOut
from src.collective.social_turn import (
    apply_social_from_llm,
    compute_applied_delta,
    infer_social_from_message,
    personality_multiplier,
    reconcile_social_perception,
    refresh_collective_snapshot,
)


@pytest.fixture(autouse=True)
def _in_memory_collective(monkeypatch):
    monkeypatch.setenv("LLM_MOCK", "1")
    reset_in_memory_store()
    yield
    reset_in_memory_store()


def test_social_turn_out_validates():
    out = SocialTurnOut(
        social=SocialPerception(kind="rude", summary="玩家言语不敬", delta=-8),
        reply="你怎么这样说话？",
    )
    assert out.social.kind == "rude"
    assert len(out.reply) >= 1


def test_personality_npc1_more_sensitive_than_npc3():
    base_kind = "rude"
    d1 = compute_applied_delta("npc-1", base_kind)
    d3 = compute_applied_delta("npc-3", base_kind)
    assert d1 < d3
    assert personality_multiplier("npc-1", base_kind) > personality_multiplier("npc-3", base_kind)


def test_apply_rude_insult_negative_rep():
    result = apply_social_from_llm(
        room_id="room-1",
        npc_id="npc-1",
        player_id="player-a",
        perception=SocialPerception(kind="rude", summary="玩家言语不敬", delta=-8),
        npc_positions={"npc-1": (2, 2)},
    )
    assert result.applied is True
    assert result.delta_applied < 0
    assert result.player_reputation is not None
    assert result.player_reputation < 0


def test_apply_help_positive_rep():
    result = apply_social_from_llm(
        room_id="room-2",
        npc_id="npc-2",
        player_id="player-a",
        perception=SocialPerception(kind="help", summary="玩家请求帮助", delta=6),
    )
    assert result.applied is True
    assert result.delta_applied > 0


def test_apply_ignore_skips_write():
    result = apply_social_from_llm(
        room_id="room-3",
        npc_id="npc-1",
        player_id="player-a",
        perception=SocialPerception(kind="ignore", summary="", delta=0),
    )
    assert result.applied is False
    from src.collective import repository as repo_mod

    assert not repo_mod._in_memory_events


def test_refresh_collective_snapshot_updates_band():
    apply_result = apply_social_from_llm(
        room_id="room-4",
        npc_id="npc-1",
        player_id="player-a",
        perception=SocialPerception(kind="rude", summary="玩家言语不敬", delta=-8),
    )
    state = {
        "attitude_band": "neutral",
        "effective_score": 0,
        "social_perception": {"summary": "玩家言语不敬"},
    }
    refreshed = refresh_collective_snapshot(state, apply_result)
    assert refreshed.get("collective_updated") is True
    assert refreshed.get("attitude_band") in ("hostile", "wary", "neutral")
    assert "玩家言语不敬" in (refreshed.get("collective_summaries") or [""])[0]


def test_infer_insult_from_message():
    inferred = infer_social_from_message("你好丑啊，活该被打")
    assert inferred is not None
    assert inferred.kind == "rude"


def test_infer_rude_from_ru_cu():
    """verify:phase12 player A speak — must backstop when LLM returns ignore."""
    inferred = infer_social_from_message("你真粗鲁")
    assert inferred is not None
    assert inferred.kind == "rude"


def test_reconcile_upgrades_llm_ignore_on_insult():
    perception = SocialPerception(kind="ignore", summary="", delta=0)
    reconciled = reconcile_social_perception("你好丑啊，活该被打", perception)
    assert reconciled.kind == "rude"
    assert reconciled.summary == "玩家言语不敬"


def test_reconcile_upgrades_llm_ignore_on_ru_cu():
    perception = SocialPerception(kind="ignore", summary="", delta=0)
    reconciled = reconcile_social_perception("你真粗鲁", perception)
    assert reconciled.kind == "rude"


def test_reconcile_keeps_llm_ignore_on_neutral():
    perception = SocialPerception(kind="ignore", summary="", delta=0)
    reconciled = reconcile_social_perception("今天天气不错", perception)
    assert reconciled.kind == "ignore"
