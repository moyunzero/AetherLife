"""Compact council persona blocks for worker speak injection (PERSONA-02, D-SPEAK-01).

Single source: packages/shared/council-personas-speak.json (from LOCKED dossiers).
Regenerate: pnpm council:export-personas
"""

from __future__ import annotations

from typing import Any

from src.council.constants import COUNCIL_NPC_IDS
from src.council.speak_registry import SpeakPersona, SpeakRelationship, get_speak_persona

SPEAK_PROMPT_CHAR_BUDGET = 800

_RELATIONSHIP_KIND_PRIORITY: dict[str, int] = {
    "rival": 0,
    "nemesis": 1,
    "ally": 2,
    "peer": 3,
    "respect": 4,
    "strategic_ally": 5,
}


def _relationship_priority(kind: str) -> int:
    return _RELATIONSHIP_KIND_PRIORITY.get(kind, 50)


def _top_relationships(relationships: list[SpeakRelationship], limit: int = 3) -> list[SpeakRelationship]:
    return sorted(relationships, key=lambda r: _relationship_priority(r["kind"]))[:limit]


def _runtime_edges_to_relationships(
    npc_id: str,
    edges: list[dict[str, Any]],
    *,
    limit: int = 3,
) -> list[SpeakRelationship]:
    related = [e for e in edges if e.get("npcAId") == npc_id or e.get("npcBId") == npc_id]
    related.sort(key=lambda e: abs(int(e.get("affection", 0))), reverse=True)
    lines: list[SpeakRelationship] = []
    for edge in related[:limit]:
        other = edge["npcBId"] if edge.get("npcAId") == npc_id else edge["npcAId"]
        affection = int(edge.get("affection", 0))
        status_tags = edge.get("currentStatus") or edge.get("current_status") or []
        history = (edge.get("historySummary") or edge.get("history_summary") or "").strip()
        tag_str = "、".join(str(t) for t in status_tags[:3])
        kind = str(edge.get("baseTag") or "mixed")
        summary_parts = []
        if tag_str:
            summary_parts.append(f"[{tag_str}]")
        summary_parts.append(f"affection={affection}")
        if history:
            summary_parts.append(history[:60])
        lines.append(
            SpeakRelationship(
                targetId=str(other),
                kind=kind,
                summary=" ".join(summary_parts),
            )
        )
    return lines


def _truncate_voting_logic(voting_logic: str, max_len: int = 120) -> str:
    stripped = voting_logic.replace("**", "").replace("  ", " ").strip()
    if len(stripped) <= max_len:
        return stripped
    return f"{stripped[: max_len - 1]}…"


def _truncate_backstory(backstory: str, max_len: int = 160) -> str:
    if len(backstory) <= max_len:
        return backstory
    return f"{backstory[: max_len - 1]}…"


def _format_persona_block(
    persona: SpeakPersona,
    *,
    relationships: list[SpeakRelationship] | None = None,
) -> str:
    rel_source = relationships if relationships is not None else persona["relationships"]
    rel_lines = [
        f"·{r['targetId']}({r['kind']})：{r['summary']}"
        for r in _top_relationships(rel_source)
    ]
    sections = [
        f"【{persona['displayName']}】",
        f"位面：{persona['originPlane']}",
        f"职业：{persona['profession']}",
        f"性格：{persona['personality']}",
        f"反差：{persona['contrastMoe']}",
        f"背景：{_truncate_backstory(persona['backstory'])}",
        f"关系：\n{chr(10).join(rel_lines)}" if rel_lines else "",
        f"口吻：{persona['speakStyle']}",
        f"MBTI/星座：{persona['mbti']} · {persona['zodiacSign']}",
        f"投票逻辑：{_truncate_voting_logic(persona['votingLogic'])}",
    ]
    block = "\n".join(s for s in sections if s)
    if len(block) <= SPEAK_PROMPT_CHAR_BUDGET:
        return block

    shorter = [
        (
            f"背景：{_truncate_backstory(persona['backstory'], 80)}"
            if line.startswith("背景：")
            else line
        )
        for line in sections
        if line
    ]
    block = "\n".join(shorter)
    if len(block) <= SPEAK_PROMPT_CHAR_BUDGET:
        return block

    return block[:SPEAK_PROMPT_CHAR_BUDGET]


def build_persona_block(
    npc_id: str,
    runtime_relationships: list[dict[str, Any]] | None = None,
) -> str:
    """Return compact persona block for all COUNCIL_NPC_IDS; runtime edges override registry."""
    if npc_id not in COUNCIL_NPC_IDS:
        return ""
    persona = get_speak_persona(npc_id)
    if persona is None:
        return ""
    rels: list[SpeakRelationship] | None = None
    if runtime_relationships:
        rels = _runtime_edges_to_relationships(npc_id, runtime_relationships)
        if not rels:
            rels = None
    return _format_persona_block(persona, relationships=rels)
