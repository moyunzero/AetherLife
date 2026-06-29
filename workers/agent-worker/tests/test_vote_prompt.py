"""Tests for council vote prompt framing."""

from __future__ import annotations

from src.council.constants import COUNCIL_NPC_IDS
from src.council.vote_prompt import (
    COUNCIL_VOTE_SETTING,
    FEED_QUOTE_MAX,
    build_vote_persona_block,
    clamp_feed_quote,
    debate_output_instructions,
    finalize_deliberation_sync_payload,
    sanitize_council_text,
)


def test_council_setting_forbids_feudal_tone():
    assert "十二席地位完全平等" in COUNCIL_VOTE_SETTING
    assert "禁止封建君臣口吻" in COUNCIL_VOTE_SETTING


def test_sanitize_rewrites_feudal_phrases():
    raw = "臣莫玄虚恳请廷议通过以下措施，望诸位大人审时度势，酌情采纳。"
    out = sanitize_council_text(raw)
    assert "臣" not in out
    assert "恳请廷议" not in out
    assert "诸位大人" not in out
    assert "本席莫玄虚" in out


def test_sanitize_replaces_english_leaks():
    assert "军事化" in sanitize_council_text("This will militarize trade.")


def test_persona_block_covers_all_twelve_seats():
    for npc_id in COUNCIL_NPC_IDS:
        block = build_vote_persona_block(npc_id, None)
        assert block
        assert "职业：" in block
        assert "口吻：" in block


def test_format_proposer_relationship_runtime_edge():
    from src.council.relationship_prompt import format_proposer_relationship

    edges = [
        {
            "npcAId": "npc-1",
            "npcBId": "npc-7",
            "affection": 30,
            "baseTag": "respect",
            "currentStatus": ["mutual_respect"],
            "historySummary": "调解成功",
        }
    ]
    block = format_proposer_relationship("npc-7", "npc-1", edges)
    assert "与提案人" in block
    assert "npc-1" in block or "莫玄虚" in block


def test_ballot_instructions_name_proposer():
    from src.council.vote_prompt import ballot_prompt_instructions

    block = ballot_prompt_instructions(proposer_id="npc-1", proposer_name="莫玄虚")
    assert "莫玄虚" in block
    assert "不计入票决" in block


def test_debate_output_instructions_dual_slot():
    block = debate_output_instructions()
    assert "fullText" in block
    assert "feedQuote" in block


def test_clamp_feed_quote_max_eighty():
    long_text = "字" * 95
    assert len(clamp_feed_quote(long_text)) == FEED_QUOTE_MAX


def test_finalize_sync_clamps_feed_quote_and_skips_invalid_quote_rows():
    out = finalize_deliberation_sync_payload(
        {
            "active": True,
            "phase": "debate",
            "voteKind": "regular",
            "round": 1,
            "roundTotal": 2,
            "feedDelta": [
                {
                    "kind": "quote",
                    "npcId": "npc-1",
                    "displayName": "莫玄虚",
                    "text": "字" * 95,
                },
                {
                    "kind": "quote",
                    "npcId": "",
                    "displayName": "无名",
                    "text": "应跳过",
                },
            ],
        }
    )
    assert len(out["feedDelta"]) == 1
    assert len(out["feedDelta"][0]["text"]) == FEED_QUOTE_MAX


def test_finalize_sync_omits_null_result_entry_id():
    out = finalize_deliberation_sync_payload(
        {
            "active": False,
            "phase": "sealed",
            "voteKind": "regular",
            "resultEntryId": None,
            "roundTotal": 0,
            "feedDelta": [
                {
                    "kind": "quote",
                    "npcId": "npc-1",
                    "displayName": "莫玄虚",
                    "text": "   ",
                }
            ],
        }
    )
    assert "resultEntryId" not in out
    assert out["roundTotal"] == 1
    assert len(out["feedDelta"][0]["text"]) >= 1
