"""Runtime relationship blocks for council vote/debate prompts (REL-04, all 12 seats)."""

from __future__ import annotations

from typing import Any

from src.council.constants import COUNCIL_NPC_IDS
from src.council.registry import get_persona
from src.council.speak_registry import get_speak_persona


def _registry_relationship_summary(voter_id: str, proposer_id: str) -> str:
    speak = get_speak_persona(voter_id)
    if not speak:
        return ""
    for rel in speak.get("relationships") or []:
        if rel.get("targetId") == proposer_id:
            kind = rel.get("kind") or "peer"
            summary = (rel.get("summary") or "").strip()
            return f"[{kind}] {summary[:100]}" if summary else f"[{kind}]"
    return ""


def _find_runtime_edge(
    voter_id: str,
    proposer_id: str,
    edges: list[dict[str, Any]],
) -> dict[str, Any] | None:
    for edge in edges:
        a, b = edge.get("npcAId"), edge.get("npcBId")
        if (a == voter_id and b == proposer_id) or (a == proposer_id and b == voter_id):
            return edge
    return None


def format_proposer_relationship(
    voter_id: str,
    proposer_id: str,
    edges: list[dict[str, Any]],
) -> str:
    """Dedicated proposer edge block for ballot prompts (ISSUE-060)."""
    proposer_name = display_name_for_edge(proposer_id)
    header = f"【与提案人】{proposer_name}（{proposer_id}）"
    runtime = _find_runtime_edge(voter_id, proposer_id, edges)
    if runtime:
        return f"{header}\n{format_edge_line(runtime, voter_id)}"
    registry_line = _registry_relationship_summary(voter_id, proposer_id)
    if registry_line:
        return f"{header}\n·{proposer_name} {registry_line}"
    return f"{header}\n·请结合本席 persona 与议会立场判断对此提案态度。"


def format_debate_transcript_summary(
    transcript: list[dict[str, Any]],
    *,
    max_chars: int = 2000,
) -> str:
    """Compact debate context for ballot prompts."""
    if not transcript:
        return "（本轮无辩论记录）"
    lines: list[str] = []
    for row in transcript:
        name = row.get("displayName") or display_name_for_edge(str(row.get("npcId") or ""))
        round_num = row.get("round", 0)
        text = str(row.get("text") or "")[:120]
        lines.append(f"第{round_num}轮 {name}：{text}")
    body = "\n".join(lines)
    return body[:max_chars]


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
