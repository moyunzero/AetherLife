"""Speak persona registry — loaded from packages/shared/council-personas-speak.json.

Single source: LOCKED dossiers in packages/shared/src/council/dossiers/.
Regenerate: pnpm council:export-personas
"""

from __future__ import annotations

import json
from typing import TypedDict

from src.council.paths import monorepo_root


class SpeakRelationship(TypedDict):
    targetId: str
    kind: str
    summary: str


class SpeakPersona(TypedDict):
    displayName: str
    originPlane: str
    profession: str
    personality: str
    contrastMoe: str
    backstory: str
    speakStyle: str
    mbti: str
    zodiacSign: str
    votingLogic: str
    relationships: list[SpeakRelationship]


_SPEAK_PATH = monorepo_root() / "packages" / "shared" / "council-personas-speak.json"


def _load_speak_personas() -> dict[str, SpeakPersona]:
    if not _SPEAK_PATH.is_file():
        return {}
    raw = json.loads(_SPEAK_PATH.read_text(encoding="utf-8"))
    personas: dict[str, SpeakPersona] = {}
    for npc_id, entry in raw.items():
        rels = entry.get("relationships") or []
        personas[npc_id] = SpeakPersona(
            displayName=str(entry["displayName"]),
            originPlane=str(entry["originPlane"]),
            profession=str(entry["profession"]),
            personality=str(entry["personality"]),
            contrastMoe=str(entry["contrastMoe"]),
            backstory=str(entry["backstory"]),
            speakStyle=str(entry["speakStyle"]),
            mbti=str(entry["mbti"]),
            zodiacSign=str(entry["zodiacSign"]),
            votingLogic=str(entry["votingLogic"]),
            relationships=[
                SpeakRelationship(
                    targetId=str(r["targetId"]),
                    kind=str(r["kind"]),
                    summary=str(r["summary"]),
                )
                for r in rels
            ],
        )
    return personas


SPEAK_PERSONAS: dict[str, SpeakPersona] = _load_speak_personas()


def get_speak_persona(npc_id: str) -> SpeakPersona | None:
    return SPEAK_PERSONAS.get(npc_id)
