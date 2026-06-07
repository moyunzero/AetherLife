import os

from src.collective.refine import (
    CollectiveRefineOut,
    maybe_collective_refine,
    run_collective_refine_llm,
)
from src.collective.repository import reset_in_memory_store
from src.config import Settings


def test_collective_refine_out_validates_kind():
    out = CollectiveRefineOut(kind="rude", summary="玩家言语不敬", delta=-8)
    assert out.delta == -8


def test_run_collective_refine_llm_mock(monkeypatch):
    monkeypatch.setenv("LLM_MOCK", "1")
    out = run_collective_refine_llm("你真蠢", settings=Settings(llm_mock=True))
    assert out is not None
    assert out.kind == "rude"
    assert len(out.summary) <= 80


def test_maybe_collective_refine_inserts_when_importance_high(monkeypatch):
    monkeypatch.setenv("LLM_MOCK", "1")
    reset_in_memory_store()
    state = {
        "room_id": "room-1",
        "npc_id": "npc-1",
        "player_id": "player-a",
        "player_message": "滚开",
        "turn_importance": 8,
    }
    result = maybe_collective_refine(state, settings=Settings(llm_mock=True))
    assert result["room_id"] == "room-1"


def test_maybe_collective_refine_skips_low_importance(monkeypatch):
    monkeypatch.setenv("LLM_MOCK", "1")
    reset_in_memory_store()
    state = {
        "room_id": "room-2",
        "npc_id": "npc-1",
        "player_id": "player-a",
        "player_message": "你好",
        "turn_importance": 3,
    }
    maybe_collective_refine(state, settings=Settings(llm_mock=True))
    from src.collective import repository as repo_mod

    assert not repo_mod._in_memory_events


def test_maybe_collective_refine_runs_when_ambiguous(monkeypatch):
    monkeypatch.setenv("LLM_MOCK", "1")
    reset_in_memory_store()
    state = {
        "room_id": "room-3",
        "npc_id": "npc-1",
        "player_id": "player-a",
        "player_message": "什么玩意",
        "turn_importance": 3,
        "collective_ambiguous": True,
    }
    maybe_collective_refine(state, settings=Settings(llm_mock=True))
    from src.collective import repository as repo_mod

    assert len(repo_mod._in_memory_events) == 1
