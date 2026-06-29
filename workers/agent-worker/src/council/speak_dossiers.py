"""Compact speak dossiers — re-export from speak_registry (D-SPEAK-01)."""

from __future__ import annotations

from src.council.speak_registry import SpeakPersona, get_speak_persona


def get_speak_dossier(npc_id: str) -> SpeakPersona | None:
    return get_speak_persona(npc_id)
