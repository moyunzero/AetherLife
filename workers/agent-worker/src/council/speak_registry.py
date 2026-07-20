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
        raise FileNotFoundError(
            f"Missing speak persona mirror: {_SPEAK_PATH}. Run pnpm council:export-personas"
        )
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

_PERSONA_BLOCK_MAX = 600


def get_speak_persona(npc_id: str) -> SpeakPersona | None:
    return SPEAK_PERSONAS.get(npc_id)


def _truncate(text: str, max_len: int) -> str:
    t = (text or "").strip()
    if len(t) <= max_len:
        return t
    return f"{t[: max_len - 1]}…"


def persona_block_for(npc_id: str) -> str:
    """Compact diary/speak voice block from speak mirror (口吻 + 性格)."""
    p = get_speak_persona(npc_id)
    if not p:
        return f"【{npc_id}】（人设镜像缺失，请用席位默认第一人称，避免通用文艺套话。）"
    rels = p.get("relationships") or []
    rel_lines = []
    for r in rels[:3]:
        rel_lines.append(f"·{r['targetId']}({r['kind']})：{_truncate(r['summary'], 40)}")
    sections = [
        f"【{p['displayName']}】",
        f"位面/职业：{p['originPlane']} · {p['profession']}",
        f"性格：{_truncate(p['personality'], 120)}",
        f"反差：{_truncate(p['contrastMoe'], 80)}",
        f"口吻：{_truncate(p['speakStyle'], 120)}",
        f"MBTI/星座：{p['mbti']} · {p['zodiacSign']}",
    ]
    if rel_lines:
        sections.append("关系：\n" + "\n".join(rel_lines))
    block = "\n".join(sections)
    if len(block) > _PERSONA_BLOCK_MAX:
        return block[:_PERSONA_BLOCK_MAX]
    return block
