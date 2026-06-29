"""Council vote/debate LLM framing — 12 equal seats, Aether Nexus lore (Phase 25)."""

from __future__ import annotations

import re
from typing import Any

from src.graph.persona import build_persona_block

# Locked tone rules — mirrors packages/shared/src/aetherNexusLore.ts (太乙议会)
COUNCIL_VOTE_SETTING = """【太乙议会廷议设定 — 必须遵守】
- 万界崩裂纪后，十二大位面各派使节常驻始源区，组成太乙议会。十二席地位完全平等，互称「本席」「诸位同僚」。
- 禁止封建君臣口吻：不得出现「臣」「恳请廷议通过」「望诸位大人」「酌情采纳」「启禀」「微臣」等下级对上级的用语。
- 提案正文须以提案人第一人称撰写（如「本席提请…」「依本席之见…」），结尾邀请同僚评议表决；文风须符合该席位面与 speakStyle（例：莫玄虚古雅仙侠、阿斯托利亚军事统帅、糖果软萌赛博、白星烬温柔歌者）。
- 票决理由 reasonZh 须体现该席 profession、personality、votingLogic 与 runtime 关系；禁止英文词；禁止「总体利大于弊」「符合本席立场」「提案人附议」等空泛套话。
- 全部输出简体中文。"""

_FORBIDDEN_REPLACEMENTS: tuple[tuple[str, str], ...] = (
    ("臣莫玄虚", "本席莫玄虚"),
    ("微臣", "本席"),
    ("恳请廷议通过", "提请议会审议"),
    ("恳请廷议", "提请议会"),
    ("望诸位大人审时度势，酌情采纳", "请诸位同僚评议表决"),
    ("望诸位大人", "请诸位同僚"),
    ("酌情采纳", "共商取舍"),
    ("启禀", "禀告"),
)

_ENGLISH_TO_ZH: dict[str, str] = {
    "militarize": "军事化",
    "militarized": "军事化",
    "militarization": "军事化",
}

# ISSUE-094 / 25-FEED-DUAL-OUTPUT — feedQuote (live) vs fullText (transcript/minutes)
FEED_QUOTE_MAX = 80
FEED_QUOTE_PROMPT_MAX = 70
FULL_DEBATE_MAX = 180
FULL_DEBATE_PROMPT_MAX = 150
VOTE_REASON_MAX = 120


def build_vote_persona_block(
    npc_id: str,
    relationship_edges: list[dict[str, Any]] | None = None,
) -> str:
    """Full speak dossier block for vote/debate prompts (all 12 seats)."""
    return build_persona_block(npc_id, relationship_edges)


def sanitize_council_text(text: str) -> str:
    """Post-process LLM output to strip feudal / English slips."""
    out = (text or "").strip()
    for old, new in _FORBIDDEN_REPLACEMENTS:
        out = out.replace(old, new)
    for en, zh in _ENGLISH_TO_ZH.items():
        out = re.sub(rf"\b{en}\b", zh, out, flags=re.IGNORECASE)
    return out


def non_empty_council_line(text: str, fallback: str, *, max_len: int) -> str:
    """Ensure feed/ballot lines never violate zod min(1) after LLM whitespace."""
    cleaned = sanitize_council_text(text).strip()
    if not cleaned:
        cleaned = sanitize_council_text(fallback).strip() or "本席暂无补充。"
    return cleaned[:max_len]


def clamp_feed_quote(text: str, *, fallback: str = "本席暂无补充。") -> str:
    """Council Tab live feed — matches councilDeliberation quote.text max(80)."""
    return non_empty_council_line(text, fallback, max_len=FEED_QUOTE_MAX)


def clamp_full_debate(text: str, *, fallback: str = "本席暂无补充。") -> str:
    """Debate transcript + minutes excerpts."""
    return non_empty_council_line(text, fallback, max_len=FULL_DEBATE_MAX)


def debate_output_instructions() -> str:
    return (
        f"输出 JSON：fullText(≤{FULL_DEBATE_PROMPT_MAX}字，完整议席发言), "
        f"feedQuote(≤{FEED_QUOTE_PROMPT_MAX}字，最锋利的一句高光，适合 Council 直播，"
        "禁止复述 fullText 全文), stance(support|oppose|neutral)。"
        "发言须体现该席性格与职业，禁止空泛套话。"
        '示例：{"fullText":"完整发言","feedQuote":"高光一句","stance":"neutral"}'
    )


def normalize_linked_edges(edges: list[dict[str, Any]] | None) -> list[dict[str, str]]:
    """Strip to linkedEdgeSchema fields only (strict zod on game-server)."""
    out: list[dict[str, str]] = []
    for edge in edges or []:
        npc_a = str(edge.get("npcAId") or "").strip()
        npc_b = str(edge.get("npcBId") or "").strip()
        if npc_a and npc_b:
            out.append({"npcAId": npc_a, "npcBId": npc_b})
    return out


def finalize_deliberation_sync_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """Drop null optional fields and normalize feed rows before POST."""
    out = dict(payload)
    if out.get("resultEntryId") in (None, ""):
        out.pop("resultEntryId", None)
    if "linkedEdges" in out:
        out["linkedEdges"] = normalize_linked_edges(out.get("linkedEdges"))
    feed = out.get("feedDelta")
    if isinstance(feed, list):
        normalized_feed: list[dict[str, Any]] = []
        for row in feed:
            if not isinstance(row, dict):
                continue
            kind = row.get("kind")
            if kind == "quote":
                npc_id = str(row.get("npcId") or "").strip()
                display = str(row.get("displayName") or "").strip()
                if not npc_id or not display:
                    continue
                text = clamp_feed_quote(str(row.get("text") or ""))
                if not text:
                    continue
                normalized_row: dict[str, Any] = {
                    **row,
                    "npcId": npc_id,
                    "displayName": display[:40],
                    "text": text,
                }
                if row.get("travelerRef") is True:
                    normalized_row["travelerRef"] = True
                normalized_feed.append(normalized_row)
            elif kind == "vote":
                reason = row.get("reasonZh")
                if reason is not None:
                    reason_text = non_empty_council_line(
                        str(reason),
                        "依本席判断。",
                        max_len=VOTE_REASON_MAX,
                    )
                    normalized_feed.append({**row, "reasonZh": reason_text})
                else:
                    normalized_feed.append(dict(row))
            else:
                normalized_feed.append(dict(row))
        out["feedDelta"] = normalized_feed
    title = out.get("proposalTitle")
    if isinstance(title, str):
        out["proposalTitle"] = sanitize_council_text(title)[:120]
    round_total = out.get("roundTotal")
    if isinstance(round_total, int):
        out["roundTotal"] = max(1, round_total)
    return out


def proposal_prompt_instructions(*, is_proposer: bool = False) -> str:
    if is_proposer:
        return (
            "你是提案人。写 title + proposal 正文。"
            "正文结构：背景/问题 → 具体措施（可分条）→ 邀请同僚评议。"
            "须用本席口吻，体现 profession 与 speakStyle，禁止君臣套话。"
        )
    return ""


def ballot_prompt_instructions(*, proposer_id: str = "", proposer_name: str = "") -> str:
    proposer_line = ""
    if proposer_id and proposer_name:
        proposer_line = f"提案人：{proposer_name}（{proposer_id}，本席不计票）。"
    return (
        f"{proposer_line}"
        "你是表决人（提案人已提请议案，**不计入票决**）。"
        "根据 persona 的 votingLogic、与提案人关系及本轮辩论内容决定 yes/no。"
        "reasonZh 须与 vote 一致：vote=yes 写支持理由，vote=no 写反对理由；"
        "须像该角色在议席上亲口表态（可点名同僚、位面利益、职业视角），"
        "80字以内，禁止模板化套话。"
    )


_OPPOSE_MARKERS = (
    "反对",
    "不能苟同",
    "不宜通过",
    "否决",
    "过激",
    "恐乱",
    "违背",
    "不合算",
    "不可控",
    "侵犯主权",
    "此议过",
    "持异议",
    "不能同意",
    "暂不宜",
)
_SUPPORT_MARKERS = (
    "赞成",
    "附议",
    "支持通过",
    "可落地",
    "确有必要",
    "理应",
    "值得",
    "最优解",
    "维护稳定",
    "符合长期",
    "确凿无疑",
)


def reconcile_ballot_vote_reason(ballot: dict[str, Any]) -> dict[str, Any]:
    """Align vote with reason when LLM JSON vote contradicts reasonZh tone."""
    vote = str(ballot.get("vote") or "no").lower()
    if vote not in ("yes", "no"):
        vote = "no"
    reason = str(ballot.get("reasonZh") or "")
    oppose = sum(1 for marker in _OPPOSE_MARKERS if marker in reason)
    support = sum(1 for marker in _SUPPORT_MARKERS if marker in reason)
    if vote == "yes" and oppose > support and oppose >= 1:
        return {**ballot, "vote": "no"}
    if vote == "no" and support > oppose and support >= 2:
        return {**ballot, "vote": "yes"}
    return {**ballot, "vote": vote}
