"""Worker council registry must match packages/shared LOCKED dossiers."""

from __future__ import annotations

import json
from pathlib import Path

from src.council.constants import COUNCIL_NPC_IDS
from src.council.registry import COUNCIL_PERSONAS, display_name

from src.council.paths import monorepo_root

_COMPACT_PATH = monorepo_root() / "packages" / "shared" / "council-personas-compact.json"


def test_registry_has_twelve_seats():
    assert set(COUNCIL_PERSONAS.keys()) == set(COUNCIL_NPC_IDS)


def test_registry_matches_shared_compact_json():
    assert _COMPACT_PATH.is_file(), f"missing {_COMPACT_PATH}"
    expected = json.loads(_COMPACT_PATH.read_text(encoding="utf-8"))
    for npc_id in COUNCIL_NPC_IDS:
        assert npc_id in expected
        persona = COUNCIL_PERSONAS[npc_id]
        exp = expected[npc_id]
        assert persona["displayName"] == exp["displayName"]
        assert persona["votingLeaning"] == exp["votingLeaning"]
        assert persona["archetype"] == exp["archetype"]


def test_display_name_known_seats():
    assert display_name("npc-4") == "糖果"
    assert display_name("npc-8") == "克里斯"
    assert display_name("npc-10") == "斯卡蒂"
