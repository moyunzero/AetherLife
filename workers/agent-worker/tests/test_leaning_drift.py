"""REL-08 leaningDrift clamp/cap boundary tests."""

from __future__ import annotations

import pytest

from src.council.leaning_drift import (
    apply_speak_leaning_drift,
    clear_leaning_drift_store_for_tests,
    get_leaning_drift,
)


@pytest.fixture(autouse=True)
def _reset_store():
    clear_leaning_drift_store_for_tests()
    yield
    clear_leaning_drift_store_for_tests()


def test_single_delta_clamped_to_two():
    room = "room-clamp"
    npc = "npc-3"
    applied = apply_speak_leaning_drift(room, npc, 5, game_minute=480)
    assert applied == 2
    assert get_leaning_drift(room, npc) == 2


def test_day_cap_rejects_fourth_increment_same_bucket():
    room = "room-day-cap"
    npc = "npc-5"
    minute = 960
    assert apply_speak_leaning_drift(room, npc, 2, game_minute=minute) == 2
    assert apply_speak_leaning_drift(room, npc, 2, game_minute=minute) == 2
    assert apply_speak_leaning_drift(room, npc, 2, game_minute=minute) == 2
    assert get_leaning_drift(room, npc) == 6
    assert apply_speak_leaning_drift(room, npc, 2, game_minute=minute) == 0
    assert get_leaning_drift(room, npc) == 6


def test_total_drift_clamped_at_negative_thirty():
    room = "room-total"
    npc = "npc-7"
    for i in range(14):
        apply_speak_leaning_drift(room, npc, -2, game_minute=i * 480)
    assert get_leaning_drift(room, npc) == -28
    applied = apply_speak_leaning_drift(room, npc, -2, game_minute=14 * 480)
    assert applied == -2
    assert get_leaning_drift(room, npc) == -30
    assert apply_speak_leaning_drift(room, npc, -2, game_minute=15 * 480) == 0
    assert get_leaning_drift(room, npc) == -30
