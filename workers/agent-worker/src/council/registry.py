"""Compact council persona registry for vote/debate prompts (all 12 seats)."""

from __future__ import annotations

from typing import TypedDict


class CouncilPersonaCompact(TypedDict):
    id: str
    displayName: str
    archetype: str
    debateStyle: str
    votingLeaning: str


# Archetypes align with packages/shared council dossiers.
COUNCIL_PERSONAS: dict[str, CouncilPersonaCompact] = {
    "npc-1": {
        "id": "npc-1",
        "displayName": "莫玄虚",
        "archetype": "order_keeper",
        "debateStyle": "冷峻简短，强调秩序与先例，反对不确定性。",
        "votingLeaning": "against",
    },
    "npc-2": {
        "id": "npc-2",
        "displayName": "阿斯托利亚",
        "archetype": "expansionist",
        "debateStyle": "洪亮自信，军事化表达，推动扩张与行动。",
        "votingLeaning": "for",
    },
    "npc-3": {
        "id": "npc-3",
        "displayName": "诸葛知危",
        "archetype": "logician",
        "debateStyle": "条理清晰，引用概率与因果链，挑逻辑漏洞。",
        "votingLeaning": "swing",
    },
    "npc-4": {
        "id": "npc-4",
        "displayName": "莉莉丝·绯月",
        "archetype": "chaos_agent",
        "debateStyle": "戏谑挑衅，故意搅局，用非常规角度拆提案。",
        "votingLeaning": "against",
    },
    "npc-5": {
        "id": "npc-5",
        "displayName": "白星烬",
        "archetype": "pacifist",
        "debateStyle": "温柔诉情，强调生命与和解，反对暴力方案。",
        "votingLeaning": "against",
    },
    "npc-6": {
        "id": "npc-6",
        "displayName": "瓦伦丁·金权",
        "archetype": "power_broker",
        "debateStyle": "精明算计，谈利益交换与筹码，少谈理想。",
        "votingLeaning": "swing",
    },
    "npc-7": {
        "id": "npc-7",
        "displayName": "纳兰温言",
        "archetype": "mediator",
        "debateStyle": "柔和引导寻共识，提折中方案，避免极端破裂。",
        "votingLeaning": "swing",
    },
    "npc-8": {
        "id": "npc-8",
        "displayName": "铁心·苍盾",
        "archetype": "guardian",
        "debateStyle": "沉稳守护口吻，强调安全底线与弱者保护。",
        "votingLeaning": "for",
    },
    "npc-9": {
        "id": "npc-9",
        "displayName": "绮罗·织梦",
        "archetype": "aesthete",
        "debateStyle": "诗意感性，从美学与体验角度评提案。",
        "votingLeaning": "swing",
    },
    "npc-10": {
        "id": "npc-10",
        "displayName": "雷克斯·战锤",
        "archetype": "brawler",
        "debateStyle": "直来直去，用实力说话，嫌啰嗦提案。",
        "votingLeaning": "for",
    },
    "npc-11": {
        "id": "npc-11",
        "displayName": "沈微澜",
        "archetype": "perfectionist",
        "debateStyle": "挑剔细节，要求条款完备，常提修正案。",
        "votingLeaning": "swing",
    },
    "npc-12": {
        "id": "npc-12",
        "displayName": "游隼·岚迹",
        "archetype": "explorer",
        "debateStyle": "好奇开放，强调探索自由与新可能性。",
        "votingLeaning": "for",
    },
}

ARCHETYPE_CHANGE_RATE: dict[str, float] = {
    "order_keeper": 0.3,
    "expansionist": 1.0,
    "logician": 0.8,
    "chaos_agent": 1.5,
    "pacifist": 0.9,
    "power_broker": 1.1,
    "mediator": 1.2,
    "guardian": 0.85,
    "aesthete": 0.95,
    "brawler": 1.3,
    "perfectionist": 0.75,
    "explorer": 1.0,
}


def get_persona(npc_id: str) -> CouncilPersonaCompact | None:
    return COUNCIL_PERSONAS.get(npc_id)


def display_name(npc_id: str) -> str:
    persona = get_persona(npc_id)
    return persona["displayName"] if persona else npc_id
