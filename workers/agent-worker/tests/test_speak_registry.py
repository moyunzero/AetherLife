"""Speak persona JSON must match LOCKED dossiers export."""

from __future__ import annotations

import json

from src.council.constants import COUNCIL_NPC_IDS
from src.council.paths import monorepo_root
from src.council.speak_registry import SPEAK_PERSONAS, get_speak_persona
from src.graph.persona import build_persona_block

_SPEAK_PATH = monorepo_root() / "packages" / "shared" / "council-personas-speak.json"


def test_speak_json_exists():
    assert _SPEAK_PATH.is_file(), f"missing {_SPEAK_PATH}"


def test_speak_registry_has_twelve_seats():
    assert set(SPEAK_PERSONAS.keys()) == set(COUNCIL_NPC_IDS)


def test_speak_json_matches_loaded_registry():
    expected = json.loads(_SPEAK_PATH.read_text(encoding="utf-8"))
    for npc_id in COUNCIL_NPC_IDS:
        assert npc_id in expected
        persona = get_speak_persona(npc_id)
        assert persona is not None
        assert persona["displayName"] == expected[npc_id]["displayName"]
        assert persona["profession"] == expected[npc_id]["profession"]


def test_all_seats_build_speak_blocks():
    for npc_id in COUNCIL_NPC_IDS:
        block = build_persona_block(npc_id)
        assert block, f"{npc_id} should produce non-empty speak block"
        assert expected_display_name(npc_id) in block


def expected_display_name(npc_id: str) -> str:
    persona = get_speak_persona(npc_id)
    assert persona is not None
    return persona["displayName"]
