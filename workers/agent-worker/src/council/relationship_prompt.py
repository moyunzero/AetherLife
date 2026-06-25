"""Runtime relationship blocks for council vote/debate prompts (REL-04, all 12 seats)."""

from __future__ import annotations

from typing import Any

from src.council.constants import COUNCIL_NPC_IDS
from src.council.registry import get_persona


def _registry_fallback_summary(npc_id: str, other_id: str) -> str:
    persona = get_persona(npc_id)
    if not persona:
        return ""
    # Minimal fallback — full registry lives in shared dossiers; worker uses runtime first.
    return f"与{other_id}的议会关系（registry fallback）"


def format_edge_line(edge: dict[str, Any], perspective_npc_id: str) -> str:
    other = edge["npcBId"] if edge["npcAId"] == perspective_npc_id else edge["npcAId"]
    other_name = display_name_for_edge(other)
    affection = edge.get("affection", 0)
    status_tags = edge.get("currentStatus") or edge.get("current_status") or []
    history = (edge.get("historySummary") or edge.get("history_summary") or "").strip()
    tag_str = "、".join(status_tags[:3]) if status_tags else edge.get("baseTag", "")
    summary = history or _registry_fallback_summary(perspective_npc_id, other)
    return f"·{other}({other_name}) affection={affection} [{tag_str}] {summary[:60]}"


def display_name_for_edge(npc_id: str) -> str:
    persona = get_persona(npc_id)
    return persona["displayName"] if persona else npc_id


def format_relationship_block_for_npc(
    npc_id: str,
    edges: list[dict[str, Any]],
    *,
    limit: int = 5,
) -> str:
    """Top edges by abs(affection) for one seat."""
    related = [
        e
        for e in edges
        if e.get("npcAId") == npc_id or e.get("npcBId") == npc_id
    ]
    related.sort(key=lambda e: abs(int(e.get("affection", 0))), reverse=True)
    lines = [format_edge_line(e, npc_id) for e in related[:limit]]
    if not lines:
        return f"【{display_name_for_edge(npc_id)}】暂无运行时关系记录。"
    header = f"【{display_name_for_edge(npc_id)}】运行时关系："
    return header + "\n" + "\n".join(lines)


def format_all_seats_relationship_context(edges: list[dict[str, Any]]) -> dict[str, str]:
    """Build per-seat relationship context for all COUNCIL_NPC_IDS."""
    return {npc_id: format_relationship_block_for_npc(npc_id, edges) for npc_id in COUNCIL_NPC_IDS}


def debate_prompt_relationship_section(edges: list[dict[str, Any]]) -> str:
    """Single block listing all 12 seats' runtime relationship summaries."""
    blocks = format_all_seats_relationship_context(edges)
    parts = [blocks[npc_id] for npc_id in COUNCIL_NPC_IDS if blocks.get(npc_id)]
    return "\n\n".join(parts)
